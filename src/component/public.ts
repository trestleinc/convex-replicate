import * as Y from 'yjs';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { internal } from './_generated/api';

// Current protocol version of this ConvexReplicate package
// Increment when breaking changes are introduced
export const PROTOCOL_VERSION = 1;

/**
 * Calculate exact CRDT storage size using snapshot + recent deltas.
 * Optimized for threshold-based compaction triggers.
 *
 * @param ctx - Query/Mutation context
 * @param collection - Collection name
 * @returns Total storage size in bytes
 */
async function calculateStorageSize(ctx: any, collection: string): Promise<number> {
  // Get latest snapshot (O(log n) index lookup)
  const snapshot = await ctx.db
    .query('snapshots')
    .withIndex('by_collection', (q: any) => q.eq('collection', collection))
    .order('desc')
    .first();

  // Get deltas AFTER snapshot (bounded scan)
  const recentDeltas = await ctx.db
    .query('documents')
    .withIndex('by_timestamp', (q: any) =>
      q.eq('collection', collection).gt('timestamp', snapshot?.latestCompactionTimestamp ?? 0)
    )
    .collect();

  const snapshotSize = snapshot?.snapshotBytes.byteLength ?? 0;
  const deltasSize = recentDeltas.reduce((sum: number, d: any) => sum + d.crdtBytes.byteLength, 0);

  return snapshotSize + deltasSize;
}

/**
 * Check if compaction should be triggered based on replication limit.
 * Schedules async compaction if threshold (80%) exceeded.
 *
 * @param ctx - Mutation context
 * @param collection - Collection name
 * @param replicationLimit - Size limit in bytes (optional)
 */
async function checkCompactionThreshold(
  ctx: any,
  collection: string,
  replicationLimit?: number
): Promise<void> {
  if (!replicationLimit) {
    return; // No limit configured
  }

  const currentSize = await calculateStorageSize(ctx, collection);

  if (currentSize > replicationLimit * 0.8) {
    // Check if compaction already scheduled for this collection
    const alreadyScheduled = await ctx.db.system
      .query('_scheduled_functions')
      .filter((q: any) =>
        q.and(
          q.eq(q.field('name'), 'component:compaction.compact'),
          q.eq(q.field('args').collection, collection)
        )
      )
      .first();

    if (!alreadyScheduled) {
      // Schedule compaction asynchronously (non-blocking!)
      await ctx.scheduler.runAfter(0, (internal as any).compaction.compact, {
        collection,
      });
    }
  }
}

/**
 * Insert a new document with CRDT bytes (Yjs format).
 * Appends delta to event log (event sourcing pattern).
 *
 * @param collection - Collection identifier
 * @param documentId - Unique document identifier
 * @param crdtBytes - ArrayBuffer containing Yjs CRDT bytes (delta)
 * @param version - CRDT version number
 * @param replicationLimit - Optional size limit in bytes (default: 10MB)
 */
export const insertDocument = mutation({
  args: {
    collection: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
    replicationLimit: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Append delta to event log (no duplicate check - event sourcing!)
    await ctx.db.insert('documents', {
      collection: args.collection,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
      operationType: 'insert',
    });

    // Check compaction threshold (if limit configured)
    await checkCompactionThreshold(ctx, args.collection, args.replicationLimit);

    return { success: true };
  },
});

/**
 * Update an existing document with new CRDT bytes (Yjs format).
 * Appends delta to event log (event sourcing pattern).
 *
 * @param collection - Collection identifier
 * @param documentId - Unique document identifier
 * @param crdtBytes - ArrayBuffer containing Yjs CRDT bytes (delta)
 * @param version - CRDT version number
 * @param replicationLimit - Optional size limit in bytes (default: 10MB)
 */
export const updateDocument = mutation({
  args: {
    collection: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
    replicationLimit: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Append delta to event log (no check - event sourcing!)
    await ctx.db.insert('documents', {
      collection: args.collection,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
      operationType: 'update',
    });

    // Check compaction threshold (if limit configured)
    await checkCompactionThreshold(ctx, args.collection, args.replicationLimit);

    return { success: true };
  },
});

/**
 * Delete a document from CRDT storage.
 * Appends deletion delta to event log (preserves history).
 *
 * @param collection - Collection identifier
 * @param documentId - Unique document identifier
 * @param crdtBytes - ArrayBuffer containing Yjs deletion delta
 * @param version - CRDT version number
 * @param replicationLimit - Optional size limit in bytes (default: 10MB)
 */
export const deleteDocument = mutation({
  args: {
    collection: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
    replicationLimit: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Append deletion delta to event log (preserve history!)
    await ctx.db.insert('documents', {
      collection: args.collection,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
      operationType: 'delete',
    });

    // Check compaction threshold (if limit configured)
    await checkCompactionThreshold(ctx, args.collection, args.replicationLimit);

    return { success: true };
  },
});

/**
 * Get complete event history for a document.
 * Returns all CRDT deltas in chronological order.
 *
 * Used for:
 * - Future recovery features (client-side)
 * - Audit trails
 * - Debugging
 *
 * @param collection - Collection identifier
 * @param documentId - Unique document identifier
 */
export const getDocumentHistory = query({
  args: {
    collection: v.string(),
    documentId: v.string(),
  },
  returns: v.array(
    v.object({
      crdtBytes: v.bytes(),
      version: v.number(),
      timestamp: v.number(),
      operationType: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    // Fetch ALL deltas for this document in chronological order
    const deltas = await ctx.db
      .query('documents')
      .withIndex('by_collection_document_version', (q) =>
        q.eq('collection', args.collection).eq('documentId', args.documentId)
      )
      .order('asc')
      .collect();

    return deltas.map((d) => ({
      crdtBytes: d.crdtBytes,
      version: d.version,
      timestamp: d.timestamp,
      operationType: d.operationType,
    }));
  },
});

/**
 * Stream CRDT changes for incremental replication.
 * Returns Yjs CRDT bytes for documents modified since the checkpoint.
 * Can be used for both polling (awaitReplication) and subscriptions (live updates).
 *
 * Gap Detection:
 * - If checkpoint is older than oldest available delta (deltas were compacted),
 *   serves latest snapshot instead of incremental deltas
 * - No need for compactionState table - dynamically queries oldest delta
 *
 * @param collection - Collection identifier
 * @param checkpoint - Last replication checkpoint
 * @param limit - Maximum number of changes to return (default: 100)
 */
export const stream = query({
  args: {
    collection: v.string(),
    checkpoint: v.object({
      lastModified: v.number(),
    }),
    stateVector: v.optional(v.bytes()), // Client's CRDT state for gap-free sync
    limit: v.optional(v.number()),
  },
  returns: v.object({
    changes: v.array(
      v.object({
        documentId: v.union(v.string(), v.null()), // null for snapshots
        crdtBytes: v.bytes(),
        version: v.number(),
        timestamp: v.number(),
        operationType: v.string(), // 'insert' | 'update' | 'delete' | 'snapshot'
      })
    ),
    checkpoint: v.object({
      lastModified: v.number(),
    }),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    // Try normal incremental sync first
    const documents = await ctx.db
      .query('documents')
      .withIndex('by_timestamp', (q) =>
        q.eq('collection', args.collection).gt('timestamp', args.checkpoint.lastModified)
      )
      .order('asc')
      .take(limit);

    if (documents.length > 0) {
      // Normal case: return incremental deltas
      const changes = documents.map((doc) => ({
        documentId: doc.documentId,
        crdtBytes: doc.crdtBytes,
        version: doc.version,
        timestamp: doc.timestamp,
        operationType: doc.operationType,
      }));

      const newCheckpoint = {
        lastModified: documents[documents.length - 1]?.timestamp ?? args.checkpoint.lastModified,
      };

      return {
        changes,
        checkpoint: newCheckpoint,
        hasMore: documents.length === limit,
      };
    }

    // No deltas found - either caught up OR gap detected
    // Check if gap exists (checkpoint is before oldest available delta)
    const oldestDelta = await ctx.db
      .query('documents')
      .withIndex('by_timestamp', (q) => q.eq('collection', args.collection))
      .order('asc')
      .first();

    // Gap detected: checkpoint is older than oldest delta (deltas were compacted)
    if (oldestDelta && args.checkpoint.lastModified < oldestDelta.timestamp) {
      // Gap detected - serve from snapshot

      // Fetch latest snapshot
      const snapshot = await ctx.db
        .query('snapshots')
        .withIndex('by_collection', (q) => q.eq('collection', args.collection))
        .order('desc')
        .first();

      if (!snapshot) {
        throw new Error(
          `Gap detected but no snapshot available for collection: ${args.collection}. ` +
            `Client checkpoint: ${args.checkpoint.lastModified}, ` +
            `Oldest delta: ${oldestDelta.timestamp}`
        );
      }

      // If client sent state vector, compute MINIMAL diff from snapshot
      // This preserves client's offline changes via CRDT merge!
      if (args.stateVector) {
        // Decode snapshot and compute diff against client's state
        const ydoc = new Y.Doc({ guid: args.collection });
        const snapshotDecoded = Y.decodeSnapshotV2(new Uint8Array(snapshot.snapshotBytes));
        const snapshotDoc = Y.createDocFromSnapshot(ydoc, snapshotDecoded);

        // Compute what client is missing (diff = snapshot - clientState)
        const diff = Y.encodeStateAsUpdateV2(snapshotDoc, new Uint8Array(args.stateVector));

        // Cleanup
        snapshotDoc.destroy();
        ydoc.destroy();

        return {
          changes: [
            {
              documentId: null, // Marker for state-diff
              crdtBytes: diff.buffer as ArrayBuffer,
              version: 0,
              timestamp: snapshot.createdAt,
              operationType: 'state-diff', // CRDT diff, not full snapshot
            },
          ],
          checkpoint: {
            lastModified: snapshot.latestCompactionTimestamp,
          },
          hasMore: false,
        };
      }

      // No state vector - send full snapshot (fallback for older clients)
      return {
        changes: [
          {
            documentId: null, // Marker for snapshot
            crdtBytes: snapshot.snapshotBytes,
            version: 0,
            timestamp: snapshot.createdAt,
            operationType: 'snapshot',
          },
        ],
        checkpoint: {
          lastModified: snapshot.latestCompactionTimestamp,
        },
        hasMore: false,
      };
    }

    // Caught up - no gap, just no new changes
    return {
      changes: [],
      checkpoint: args.checkpoint,
      hasMore: false,
    };
  },
});

/**
 * Get the current protocol version from the server.
 * Used by clients to check if they need to migrate local storage.
 */
export const getProtocolVersion = query({
  args: {},
  returns: v.object({
    protocolVersion: v.number(),
  }),
  handler: async (_ctx) => {
    return {
      protocolVersion: PROTOCOL_VERSION,
    };
  },
});
