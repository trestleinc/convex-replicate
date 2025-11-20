import { Effect } from 'effect';
import type { ConvexClient } from 'convex/browser';
import { GapDetectedError, SnapshotError } from './errors/index.js';
import type { Checkpoint } from '../schemas/CRDTDelta.js';
import * as Y from 'yjs';

// ============================================================================
// Gap Detection Logic
// ============================================================================

export interface GapCheckConfig {
  readonly convexClient: ConvexClient;
  readonly api: { stream: any };
  readonly collection: string;
  readonly checkpoint: Checkpoint;
}

export const checkForGap = (config: GapCheckConfig) =>
  Effect.gen(function* () {
    // Query for oldest delta in component
    const oldestDelta = yield* Effect.tryPromise({
      try: () =>
        config.convexClient.query(config.api.stream, {
          checkpoint: { lastModified: 0 },
          limit: 1,
          order: 'asc', // Oldest first
        }),
      catch: (cause) => ({
        _tag: 'GapCheckError' as const,
        cause,
      }),
    });

    // If we have deltas and our checkpoint is before the oldest delta, gap detected!
    if (
      oldestDelta &&
      oldestDelta.changes.length > 0 &&
      config.checkpoint.lastModified < oldestDelta.changes[0].timestamp
    ) {
      yield* Effect.fail(
        new GapDetectedError({
          collection: config.collection,
          checkpointTimestamp: config.checkpoint.lastModified,
          oldestDeltaTimestamp: oldestDelta.changes[0].timestamp,
        })
      );
    }

    yield* Effect.logInfo('No gap detected');
  }).pipe(Effect.timeout('5 seconds'));

// ============================================================================
// Stale Checkpoint Detection
// ============================================================================

const STALE_THRESHOLD = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

export const shouldCheckForGap = (checkpoint: Checkpoint): boolean => {
  const age = Date.now() - checkpoint.lastModified;
  return age > STALE_THRESHOLD;
};

// ============================================================================
// Snapshot Recovery
// ============================================================================

export interface SnapshotRecoveryConfig {
  readonly convexClient: ConvexClient;
  readonly api: { stream: any };
  readonly collection: string;
  readonly ydoc: Y.Doc;
  readonly rebuildTanStack: (ydoc: Y.Doc) => Effect.Effect<void>;
}

export const recoverFromSnapshot = (config: SnapshotRecoveryConfig) =>
  Effect.gen(function* () {
    yield* Effect.logInfo('Starting snapshot recovery', {
      collection: config.collection,
    });

    // Fetch latest snapshot from component
    const snapshotResponse = yield* Effect.tryPromise({
      try: () =>
        config.convexClient.query(config.api.stream, {
          checkpoint: { lastModified: 0 },
          limit: 1,
          snapshotMode: true,
        }),
      catch: (cause) =>
        new SnapshotError({
          collection: config.collection,
          reason: 'Failed to fetch snapshot',
          cause,
        }),
    });

    if (!snapshotResponse.changes || snapshotResponse.changes.length === 0) {
      yield* Effect.fail(
        new SnapshotError({
          collection: config.collection,
          reason: 'No snapshot available',
        })
      );
    }

    const snapshot = snapshotResponse.changes[0];

    // Destroy current Yjs document
    yield* Effect.sync(() => config.ydoc.destroy());

    // Apply snapshot (full state replacement)
    yield* Effect.sync(() => {
      Y.applyUpdateV2(config.ydoc, snapshot.crdtBytes, 'snapshot');
    });

    // Rebuild TanStack DB from Yjs state
    yield* config.rebuildTanStack(config.ydoc);

    yield* Effect.logInfo('Snapshot recovery complete', {
      collection: config.collection,
      snapshotTimestamp: snapshot.timestamp,
    });

    return snapshot.timestamp;
  }).pipe(
    Effect.timeout('30 seconds'),
    Effect.withSpan('snapshot.recover', {
      attributes: { collection: config.collection },
    })
  );

// ============================================================================
// Gap Detection Triggers
// ============================================================================

export interface SubscriptionConfig {
  readonly convexClient: ConvexClient;
  readonly api: { stream: any };
  readonly collection: string;
}

export const initializeSubscriptionWithGapCheck = (
  config: SubscriptionConfig,
  checkpoint: Checkpoint,
  onGapDetected: () => Effect.Effect<void>
) =>
  Effect.gen(function* () {
    // Check for stale checkpoint
    if (shouldCheckForGap(checkpoint)) {
      yield* Effect.logWarning('Stale checkpoint detected, checking for gap', {
        collection: config.collection,
        checkpointAge: Date.now() - checkpoint.lastModified,
      });

      // Attempt gap detection and recovery
      yield* checkForGap({
        convexClient: config.convexClient,
        api: config.api,
        collection: config.collection,
        checkpoint,
      }).pipe(
        Effect.catchTag('GapDetectedError', (error) =>
          Effect.gen(function* () {
            yield* Effect.logError('Gap detected, triggering recovery', {
              collection: config.collection,
              gap: error.oldestDeltaTimestamp - error.checkpointTimestamp,
            });

            // Trigger recovery callback
            yield* onGapDetected();
          })
        )
      );
    }
  });
