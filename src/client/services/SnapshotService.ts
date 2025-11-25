import { Effect, Context, Layer, Data } from 'effect';
import * as Y from 'yjs';
import { YjsService } from './YjsService';
import { CheckpointService, type Checkpoint } from './CheckpointService';
import type { NetworkError } from '../errors';

export interface SnapshotResponse {
  crdtBytes: Uint8Array;
  checkpoint: Checkpoint;
  documentCount: number;
}

export class SnapshotMissingError extends Data.TaggedError('SnapshotMissingError')<{
  collection: string;
  message: string;
}> {}

export class SnapshotRecoveryError extends Data.TaggedError('SnapshotRecoveryError')<{
  collection: string;
  cause: unknown;
}> {}

/**
 * SnapshotService handles crash recovery by replacing local state
 * with a server snapshot when difference/divergence is detected.
 */
export class SnapshotService extends Context.Tag('SnapshotService')<
  SnapshotService,
  {
    /**
     * Recovers from a server snapshot by clearing local state and applying snapshot.
     * Uses an existing Yjs document and map instead of creating new ones.
     *
     * @param ydoc - Existing Yjs document
     * @param ymap - Existing Yjs map within the document
     * @param collection - Collection name for logging
     * @param fetchSnapshot - Function to fetch snapshot from server
     */
    readonly recoverFromSnapshot: <T>(
      ydoc: Y.Doc,
      ymap: Y.Map<unknown>,
      collection: string,
      fetchSnapshot: () => Effect.Effect<SnapshotResponse | null, NetworkError>
    ) => Effect.Effect<T[], SnapshotMissingError | SnapshotRecoveryError>;
  }
>() {}

export const SnapshotServiceLive = Layer.effect(
  SnapshotService,
  Effect.gen(function* (_) {
    const yjs = yield* _(YjsService);
    const checkpointSvc = yield* _(CheckpointService);

    return SnapshotService.of({
      recoverFromSnapshot: (ydoc, ymap, collection, fetchSnapshot) =>
        Effect.gen(function* () {
          yield* Effect.logWarning('Difference detected, recovering from snapshot', {
            collection,
          });

          const snapshot = yield* fetchSnapshot();

          if (!snapshot) {
            return yield* Effect.fail(
              new SnapshotMissingError({
                collection,
                message: 'Difference detected but no snapshot available - data loss scenario',
              })
            );
          }

          // Clear existing Yjs state using the existing ydoc/ymap
          yield* yjs.transact(
            ydoc,
            () => {
              const keys = Array.from(ymap.keys());
              for (const key of keys) {
                ymap.delete(key);
              }
            },
            'snapshot-clear'
          );

          // Apply snapshot update
          yield* yjs.applyUpdate(ydoc, snapshot.crdtBytes, 'snapshot');

          // Save new checkpoint
          yield* checkpointSvc.saveCheckpoint(collection, snapshot.checkpoint);

          // Extract all items from Yjs for TanStack DB sync
          const items: any[] = [];
          ymap.forEach((itemYMap) => {
            if (itemYMap instanceof Y.Map) {
              items.push(itemYMap.toJSON());
            }
          });

          yield* Effect.logInfo('Snapshot recovery completed', {
            collection,
            checkpoint: snapshot.checkpoint,
            documentCount: items.length,
          });

          // Return items for TanStack DB sync
          return items;
        }).pipe(
          Effect.catchAll(
            (cause): Effect.Effect<never, SnapshotMissingError | SnapshotRecoveryError> => {
              if (cause instanceof SnapshotMissingError) {
                return Effect.fail(cause);
              }
              return Effect.fail(
                new SnapshotRecoveryError({
                  collection,
                  cause,
                })
              );
            }
          )
        ),
    });
  })
);
