import * as Y from 'yjs';
import { internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { getLogger } from './logger';

const logger = getLogger(['compaction']);

/**
 * Internal helper to compact a single collection.
 * Extracted for reuse by compactSeries().
 */
async function compact(ctx: any, collection: string, cutoffDays?: number) {
  const cutoffMs = (cutoffDays ?? 90) * 24 * 60 * 60 * 1000;
  const cutoffTime = Date.now() - cutoffMs;

  logger.info('Starting compaction', {
    collection,
    cutoffDays: cutoffDays ?? 90,
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
 * Clean up old snapshots to prevent unbounded growth.
 *
 * Strategy:
 * - Keep latest 2 snapshots per collection (safety buffer)
 * - Delete snapshots older than retention period
 * - Run weekly via cron job
 */
export const prune = internalMutation({
  args: {
    retentionDays: v.optional(v.number()), // Default 180 days
  },
  handler: async (ctx, args) => {
    const retentionMs = (args.retentionDays ?? 180) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - retentionMs;

    logger.info('Starting snapshot cleanup', {
      retentionDays: args.retentionDays ?? 180,
      cutoffTime,
    });

    // Get all collections
    const collections = new Set<string>();
    const allSnapshots = await ctx.db.query('snapshots').collect();
    for (const s of allSnapshots) {
      collections.add(s.collection);
    }

    let deletedCount = 0;

    for (const collection of collections) {
      // Get snapshots for this collection, newest first
      const snapshots = await ctx.db
        .query('snapshots')
        .withIndex('by_collection', (q) => q.eq('collection', collection))
        .order('desc')
        .collect();

      logger.debug('Processing collection snapshots', {
        collection,
        snapshotCount: snapshots.length,
      });

      // Delete old snapshots (keep at least 2 recent ones)
      for (let i = 2; i < snapshots.length; i++) {
        const snapshot = snapshots[i];

        if (snapshot.createdAt < cutoffTime) {
          await ctx.db.delete(snapshot._id);
          deletedCount++;
          logger.debug('Deleted old snapshot', {
            collection,
            snapshotAge: Date.now() - snapshot.createdAt,
            createdAt: snapshot.createdAt,
          });
        }
      }
    }

    const result = {
      deletedCount,
      collectionsProcessed: collections.size,
    };

    logger.info('Snapshot cleanup completed', result);

    return result;
  },
});

/**
 * Compact all collections with CRDT deltas.
 * Run via cron job for automatic maintenance.
 *
 * Strategy:
 * - Get all unique collections from documents table
 * - Run compaction for each collection
 * - Return summary of all compaction results
 *
 * @param cutoffDays - Compact deltas older than this (default: 90 days)
 */
export const compactSeries = internalMutation({
  args: {
    cutoffDays: v.optional(v.number()), // Default 90 days
  },
  handler: async (ctx, args) => {
    logger.info('Starting compaction for all collections', {
      cutoffDays: args.cutoffDays ?? 90,
    });

    // Get all unique collections from documents table
    const allDocs = await ctx.db.query('documents').collect();
    const collections = new Set<string>();
    for (const doc of allDocs) {
      collections.add(doc.collection);
    }

    logger.info('Found collections', {
      collectionCount: collections.size,
      collections: Array.from(collections),
    });

    const results = [];

    for (const collection of collections) {
      try {
        const result = await compact(ctx, collection, args.cutoffDays);

        results.push({
          collection,
          ...result,
        });
      } catch (error) {
        logger.error('Compaction failed for collection', {
          collection,
          error: error instanceof Error ? error.message : String(error),
        });

        results.push({
          collection,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const summary = {
      totalCollections: collections.size,
      successfulCompactions: results.filter((r) => r.success).length,
      failedCompactions: results.filter((r) => !r.success).length,
      results,
    };

    logger.info('Completed compaction for all collections', summary);

    return summary;
  },
});
