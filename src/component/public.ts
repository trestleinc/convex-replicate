import * as Y from 'yjs';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getLogger } from './logger';
import { OperationType } from './shared.js';

// Current protocol version of this ConvexReplicate package
// Increment when breaking changes are introduced
export const PROTOCOL_VERSION = 1;

// Re-export shared enum for server-side use
export { OperationType };

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
    vector: v.optional(v.bytes()), // Client's CRDT state for gap-free sync
    limit: v.optional(v.number()),
  },
  returns: v.object({
    changes: v.array(
      v.object({
        documentId: v.optional(v.string()),
        crdtBytes: v.bytes(),
        version: v.number(),
        timestamp: v.number(),
        operationType: v.string(), // 'delta' | 'diff' | 'snapshot'
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
        operationType: OperationType.Delta,
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

      // Send full snapshot (no diff computation to avoid state vector timing issues)
      return {
        changes: [
          {
            crdtBytes: snapshot.snapshotBytes,
            version: 0,
            timestamp: snapshot.createdAt,
            operationType: OperationType.Snapshot,
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

/**
 * Get the current schema version for a collection.
 * Used by clients to detect schema version mismatches and trigger migrations.
 *
 * Returns the version stored in the migrations table for this collection.
 * If no version is set, returns 1 (default initial version).
 *
 * @param collection - Collection identifier
 * @returns Schema version number (defaults to 1 if not set)
 */
export const getSchemaVersion = query({
  args: {
    collection: v.string(),
  },
  returns: v.object({
    schemaVersion: v.number(),
  }),
  handler: async (ctx, args) => {
    const migrationRecord = await ctx.db
      .query('migrations')
      .withIndex('by_collection', (q) => q.eq('collection', args.collection))
      .first();

    return {
      schemaVersion: migrationRecord?.version ?? 1,
    };
  },
});

/**
 * Get initial CRDT state for a collection (for SSR).
 * Returns latest snapshot if available, otherwise reconstructs from deltas.
 * Used by clients to initialize Yjs with correct Item IDs.
 *
 * @param collection - Collection identifier
 * @returns CRDT bytes (snapshot or merged deltas) + checkpoint, or null if empty
 */
export const getInitialState = query({
  args: {
    collection: v.string(),
  },
  returns: v.union(
    v.object({
      crdtBytes: v.bytes(),
      checkpoint: v.object({
        lastModified: v.number(),
      }),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const logger = getLogger(['ssr']);

    // Try to fetch latest snapshot first (most efficient)
    const snapshot = await ctx.db
      .query('snapshots')
      .withIndex('by_collection', (q) => q.eq('collection', args.collection))
      .order('desc')
      .first();

    if (snapshot) {
      logger.info('Serving initial state from snapshot', {
        collection: args.collection,
        snapshotSize: snapshot.snapshotBytes.byteLength,
        checkpoint: snapshot.latestCompactionTimestamp,
      });

      return {
        crdtBytes: snapshot.snapshotBytes,
        checkpoint: {
          lastModified: snapshot.latestCompactionTimestamp,
        },
      };
    }

    // No snapshot - reconstruct from all deltas
    const deltas = await ctx.db
      .query('documents')
      .withIndex('by_collection', (q) => q.eq('collection', args.collection))
      .collect();

    if (deltas.length === 0) {
      logger.info('No initial state available - collection is empty', {
        collection: args.collection,
      });
      return null;
    }

    logger.info('Reconstructing initial state from deltas', {
      collection: args.collection,
      deltaCount: deltas.length,
    });

    // Sort by timestamp (chronological order)
    const sorted = deltas.sort((a, b) => a.timestamp - b.timestamp);

    // Merge all deltas into single update
    const updates = sorted.map((d) => new Uint8Array(d.crdtBytes));
    const merged = Y.mergeUpdates(updates);

    logger.info('Initial state reconstructed', {
      collection: args.collection,
      originalSize: updates.reduce((sum, u) => sum + u.byteLength, 0),
      mergedSize: merged.byteLength,
      compressionRatio: (
        updates.reduce((sum, u) => sum + u.byteLength, 0) / merged.byteLength
      ).toFixed(2),
    });

    return {
      crdtBytes: merged.buffer as ArrayBuffer,
      checkpoint: {
        lastModified: sorted[sorted.length - 1].timestamp,
      },
    };
  },
});

/**
 * Internal helper to compact a single collection.
 * Extracted for reuse by compactCollection().
 */
async function _compactCollectionInternal(ctx: any, collection: string, retentionDays?: number) {
  const cutoffMs = (retentionDays ?? 90) * 24 * 60 * 60 * 1000;
  const cutoffTime = Date.now() - cutoffMs;

  const logger = getLogger(['compaction']);

  logger.info('Starting compaction', {
    collection,
    retentionDays: retentionDays ?? 90,
    cutoffTime,
  });

  // 1. Fetch old deltas for this collection
  const oldDeltas = await ctx.db
    .query('documents')
    .withIndex('by_timestamp', (q: any) =>
      q.eq('collection', collection).lt('timestamp', cutoffTime)
    )
    .collect();

  if (oldDeltas.length < 100) {
    logger.info('Skipping compaction - insufficient deltas', {
      collection,
      deltaCount: oldDeltas.length,
    });
    return {
      skipped: true,
      reason: 'insufficient deltas',
      deltaCount: oldDeltas.length,
    };
  }

  // 2. Sort by timestamp (chronological order)
  const sorted = oldDeltas.sort((a: any, b: any) => a.timestamp - b.timestamp);

  logger.info('Compacting deltas', {
    collection,
    deltaCount: sorted.length,
    oldestTimestamp: sorted[0].timestamp,
    newestTimestamp: sorted[sorted.length - 1].timestamp,
  });

  // 3. Merge updates into single update (COLLECTION-LEVEL)
  const updates = sorted.map((d: any) => new Uint8Array(d.crdtBytes));
  const merged = Y.mergeUpdates(updates);

  // 4. Create Y.Doc with correct collection GUID (matches client!)
  const ydoc = new Y.Doc({ guid: collection });
  Y.applyUpdateV2(ydoc, merged);

  // 5. Create snapshot of ENTIRE collection
  const snapshot = Y.snapshot(ydoc);
  const snapshotBytes = Y.encodeSnapshotV2(snapshot);

  logger.info('Created snapshot', {
    collection,
    snapshotSize: snapshotBytes.length,
    compressionRatio: (
      sorted.reduce((sum: any, d: any) => sum + d.crdtBytes.byteLength, 0) / snapshotBytes.length
    ).toFixed(2),
  });

  // 6. Validate snapshot contains all updates
  const isValid = updates.every((update: any) => Y.snapshotContainsUpdate(snapshot, update));

  if (!isValid) {
    logger.error('Snapshot validation failed', {
      collection,
    });
    ydoc.destroy();
    return {
      success: false,
      error: 'validation_failed',
    };
  }

  // 7. Store snapshot
  await ctx.db.insert('snapshots', {
    collection,
    snapshotBytes: snapshotBytes.buffer as ArrayBuffer,
    latestCompactionTimestamp: sorted[sorted.length - 1].timestamp,
    createdAt: Date.now(),
  });

  // 8. Delete compacted deltas
  for (const delta of sorted) {
    await ctx.db.delete(delta._id);
  }

  // Cleanup
  ydoc.destroy();

  const result = {
    success: true,
    deltasCompacted: sorted.length,
    snapshotSize: snapshotBytes.length,
    oldestDelta: sorted[0].timestamp,
    newestDelta: sorted[sorted.length - 1].timestamp,
  };

  logger.info('Compaction completed', result);

  return result;
}

/**
 * Compact a specific collection by name.
 * Used by per-collection factory methods in Replicate class.
 *
 * @param collection - Collection name to compact
 * @param retentionDays - Compact deltas older than this (default: 90 days)
 */
export const compactCollectionByName = mutation({
  args: {
    collection: v.string(),
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await _compactCollectionInternal(ctx, args.collection, args.retentionDays);
  },
});

/**
 * Prune snapshots for a specific collection by name.
 * Used by per-collection factory methods in Replicate class.
 *
 * @param collection - Collection name to prune
 * @param retentionDays - Delete snapshots older than this (default: 180 days)
 */
export const pruneCollectionByName = mutation({
  args: {
    collection: v.string(),
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const retentionMs = (args.retentionDays ?? 180) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - retentionMs;

    const logger = getLogger(['compaction']);

    logger.info('Starting snapshot cleanup for collection', {
      collection: args.collection,
      retentionDays: args.retentionDays ?? 180,
      cutoffTime,
    });

    // Get snapshots for this collection, newest first
    const snapshots = await ctx.db
      .query('snapshots')
      .withIndex('by_collection', (q) => q.eq('collection', args.collection))
      .order('desc')
      .collect();

    logger.debug('Processing collection snapshots', {
      collection: args.collection,
      snapshotCount: snapshots.length,
    });

    let deletedCount = 0;

    // Delete old snapshots (keep at least 2 recent ones)
    for (let i = 2; i < snapshots.length; i++) {
      const snapshot = snapshots[i];

      if (snapshot.createdAt < cutoffTime) {
        await ctx.db.delete(snapshot._id);
        deletedCount++;
        logger.debug('Deleted old snapshot', {
          collection: args.collection,
          snapshotAge: Date.now() - snapshot.createdAt,
          createdAt: snapshot.createdAt,
        });
      }
    }

    const result = {
      collection: args.collection,
      deletedCount,
      snapshotsRemaining: Math.min(2, snapshots.length),
    };

    logger.info('Snapshot cleanup completed for collection', result);

    return result;
  },
});
