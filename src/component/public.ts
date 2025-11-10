import * as Y from 'yjs';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// Current protocol version of this ConvexReplicate package
// Increment when breaking changes are introduced
export const PROTOCOL_VERSION = 1;

/**
 * Insert a new document with CRDT bytes (Yjs format).
 * Appends delta to event log (event sourcing pattern).
 *
 * @param collection - Collection identifier
 * @param documentId - Unique document identifier
 * @param crdtBytes - ArrayBuffer containing Yjs CRDT bytes (delta)
 * @param version - CRDT version number
 */
export const insertDocument = mutation({
  args: {
    collection: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
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
    });

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
 */
export const updateDocument = mutation({
  args: {
    collection: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
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
    });

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
 */
export const deleteDocument = mutation({
  args: {
    collection: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
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
    });

    return { success: true };
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
