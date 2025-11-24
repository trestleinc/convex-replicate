import { Effect, Context, Layer, Data } from 'effect';
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

export class SnapshotService extends Context.Tag('SnapshotService')<
  SnapshotService,
  {
    readonly recoverFromSnapshot: (
      collection: string,
      fetchSnapshot: () => Effect.Effect<SnapshotResponse | null, NetworkError>,
      truncateTanStack: () => Effect.Effect<void, never>,
      syncYjsToTanStack: () => Effect.Effect<void, never>
    ) => Effect.Effect<void, SnapshotMissingError | SnapshotRecoveryError>;
  }
>() {}

export const SnapshotServiceLive = Layer.effect(
  SnapshotService,
  Effect.gen(function* (_) {
    const yjs = yield* _(YjsService);
    const checkpoint = yield* _(CheckpointService);

    return SnapshotService.of({
      recoverFromSnapshot: (collection, fetchSnapshot, truncateTanStack, syncYjsToTanStack) =>
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

          const ydoc = yield* yjs.createDocument(collection);

          yield* Effect.sync(() => {
            const ymap = ydoc.getMap(collection);
            ydoc.transact(() => {
              const keys = Array.from(ymap.keys());
              for (const key of keys) {
                ymap.delete(key);
              }
            }, 'snapshot-clear');
          });

          yield* yjs.applyUpdate(ydoc, snapshot.crdtBytes);

          yield* truncateTanStack();
          yield* syncYjsToTanStack();

          yield* checkpoint.saveCheckpoint(collection, snapshot.checkpoint);

          return yield* Effect.logInfo('Snapshot recovery completed', {
            collection,
            checkpoint: snapshot.checkpoint,
            documentCount: snapshot.documentCount,
          });
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
          ),
          Effect.asVoid
        ),
    });
  })
);
