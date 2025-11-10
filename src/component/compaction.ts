import * as Y from 'yjs';
import { internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { getLogger } from '../client/logger';

const logger = getLogger(['component', 'compaction']);

/**
 * Compact old CRDT deltas into a single snapshot for a collection.
 *
 * Strategy:
 * - Merge all deltas older than cutoff (default 90 days)
 * - Create ONE snapshot for ENTIRE collection (not per-document)
 * - Delete compacted deltas
 * - Keep recent deltas for incremental sync
 *
 * IMPORTANT: Creates collection-level snapshots matching client Y.Doc architecture
 * (one Y.Doc per collection, not per document)
 */
export const compact = internalMutation({
  args: {
    collection: v.string(),
    cutoffDays: v.optional(v.number()), // Default 90 days
  },
  handler: async (ctx, args) => {
    const cutoffMs = (args.cutoffDays ?? 90) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - cutoffMs;

    logger.info('Starting compaction', {
      collection: args.collection,
      cutoffDays: args.cutoffDays ?? 90,
      cutoffTime,
    });

    // 1. Fetch old deltas for this collection
    const oldDeltas = await ctx.db
      .query('documents')
      .withIndex('by_timestamp', (q) =>
        q.eq('collection', args.collection).lt('timestamp', cutoffTime)
      )
      .collect();

    if (oldDeltas.length < 100) {
      logger.info('Skipping compaction - insufficient deltas', {
        collection: args.collection,
        deltaCount: oldDeltas.length,
      });
      return {
        skipped: true,
        reason: 'insufficient deltas',
        deltaCount: oldDeltas.length,
      };
    }

    // 2. Sort by timestamp (chronological order)
    const sorted = oldDeltas.sort((a, b) => a.timestamp - b.timestamp);

    logger.info('Compacting deltas', {
      collection: args.collection,
      deltaCount: sorted.length,
      oldestTimestamp: sorted[0].timestamp,
      newestTimestamp: sorted[sorted.length - 1].timestamp,
    });

    // 3. Merge updates into single update (COLLECTION-LEVEL)
    const updates = sorted.map((d) => new Uint8Array(d.crdtBytes));
    const merged = Y.mergeUpdates(updates);

    // 4. Create Y.Doc with correct collection GUID (matches client!)
    const ydoc = new Y.Doc({ guid: args.collection });
    Y.applyUpdateV2(ydoc, merged);

    // 5. Create snapshot of ENTIRE collection
    const snapshot = Y.snapshot(ydoc);
    const snapshotBytes = Y.encodeSnapshotV2(snapshot);

    logger.info('Created snapshot', {
      collection: args.collection,
      snapshotSize: snapshotBytes.length,
      compressionRatio: (
        sorted.reduce((sum, d) => sum + d.crdtBytes.byteLength, 0) / snapshotBytes.length
      ).toFixed(2),
    });

    // 6. Validate snapshot contains all updates
    const isValid = updates.every((update) => Y.snapshotContainsUpdate(snapshot, update));

    if (!isValid) {
      logger.error('Snapshot validation failed', {
        collection: args.collection,
      });
      ydoc.destroy();
      return {
        success: false,
        error: 'validation_failed',
      };
    }

    // 7. Store snapshot
    await ctx.db.insert('snapshots', {
      collection: args.collection,
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
  },
});

/**
 * Clean up old snapshots to prevent unbounded growth.
 *
 * Strategy:
 * - Keep latest 2 snapshots per collection (safety buffer)
 * - Delete snapshots older than retention period
 * - Run weekly via cron job
 */
export const cleanupSnapshots = internalMutation({
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
