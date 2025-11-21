import * as Y from 'yjs';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getLogger } from './logger';
import { OperationType } from './shared.js';

export const PROTOCOL_VERSION = 1;

export { OperationType };

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

export const stream = query({
  args: {
    collection: v.string(),
    checkpoint: v.object({
      lastModified: v.number(),
    }),
    vector: v.optional(v.bytes()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    changes: v.array(
      v.object({
        documentId: v.optional(v.string()),
        crdtBytes: v.bytes(),
        version: v.number(),
        timestamp: v.number(),
        operationType: v.string(),
      })
    ),
    checkpoint: v.object({
      lastModified: v.number(),
    }),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    const documents = await ctx.db
      .query('documents')
      .withIndex('by_timestamp', (q) =>
        q.eq('collection', args.collection).gt('timestamp', args.checkpoint.lastModified)
      )
      .order('asc')
      .take(limit);

    if (documents.length > 0) {
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

    const oldestDelta = await ctx.db
      .query('documents')
      .withIndex('by_timestamp', (q) => q.eq('collection', args.collection))
      .order('asc')
      .first();

    if (oldestDelta && args.checkpoint.lastModified < oldestDelta.timestamp) {
      const snapshot = await ctx.db
        .query('snapshots')
        .withIndex('by_collection', (q) => q.eq('collection', args.collection))
        .order('desc')
        .first();

      if (!snapshot) {
        throw new Error(
          `Disparity detected but no snapshot available for collection: ${args.collection}. ` +
            `Client checkpoint: ${args.checkpoint.lastModified}, ` +
            `Oldest delta: ${oldestDelta.timestamp}`
        );
      }

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

    return {
      changes: [],
      checkpoint: args.checkpoint,
      hasMore: false,
    };
  },
});

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

    const sorted = deltas.sort((a, b) => a.timestamp - b.timestamp);

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

async function _compactCollectionInternal(ctx: any, collection: string, retentionDays?: number) {
  const cutoffMs = (retentionDays ?? 90) * 24 * 60 * 60 * 1000;
  const cutoffTime = Date.now() - cutoffMs;

  const logger = getLogger(['compaction']);

  logger.info('Starting compaction', {
    collection,
    retentionDays: retentionDays ?? 90,
    cutoffTime,
  });

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

  const sorted = oldDeltas.sort((a: any, b: any) => a.timestamp - b.timestamp);

  logger.info('Compacting deltas', {
    collection,
    deltaCount: sorted.length,
    oldestTimestamp: sorted[0].timestamp,
    newestTimestamp: sorted[sorted.length - 1].timestamp,
  });

  const updates = sorted.map((d: any) => new Uint8Array(d.crdtBytes));
  const merged = Y.mergeUpdates(updates);

  const ydoc = new Y.Doc({ guid: collection });
  Y.applyUpdateV2(ydoc, merged);

  const snapshot = Y.snapshot(ydoc);
  const snapshotBytes = Y.encodeSnapshotV2(snapshot);

  logger.info('Created snapshot', {
    collection,
    snapshotSize: snapshotBytes.length,
    compressionRatio: (
      sorted.reduce((sum: any, d: any) => sum + d.crdtBytes.byteLength, 0) / snapshotBytes.length
    ).toFixed(2),
  });

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

  await ctx.db.insert('snapshots', {
    collection,
    snapshotBytes: snapshotBytes.buffer as ArrayBuffer,
    latestCompactionTimestamp: sorted[sorted.length - 1].timestamp,
    createdAt: Date.now(),
  });

  for (const delta of sorted) {
    await ctx.db.delete(delta._id);
  }

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

export const compactCollectionByName = mutation({
  args: {
    collection: v.string(),
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await _compactCollectionInternal(ctx, args.collection, args.retentionDays);
  },
});

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
