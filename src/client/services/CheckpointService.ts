import { Effect, Context, Layer } from 'effect';
import { IDBService } from './IDBService';
import type { IDBError, IDBWriteError } from '../errors';

export interface Checkpoint {
  lastModified: number;
}

export class CheckpointService extends Context.Tag('CheckpointService')<
  CheckpointService,
  {
    readonly loadCheckpoint: (collection: string) => Effect.Effect<Checkpoint, IDBError>;
    readonly saveCheckpoint: (
      collection: string,
      checkpoint: Checkpoint
    ) => Effect.Effect<void, IDBWriteError>;
    readonly clearCheckpoint: (collection: string) => Effect.Effect<void, IDBError>;
    readonly loadCheckpointWithStaleDetection: (
      collection: string,
      hasSSRData: boolean
    ) => Effect.Effect<Checkpoint, IDBError>;
  }
>() {}

export const CheckpointServiceLive = Layer.effect(
  CheckpointService,
  Effect.gen(function* (_) {
    const idb = yield* _(IDBService);

    const loadCheckpoint = (collection: string) =>
      Effect.gen(function* (_) {
        const key = `checkpoint:${collection}`;
        const stored = yield* _(idb.get<Checkpoint>(key));

        if (stored) {
          yield* _(
            Effect.logDebug('Loaded checkpoint from storage', {
              collection,
              checkpoint: stored,
            })
          );
          return stored;
        }

        yield* _(
          Effect.logDebug('No stored checkpoint, using default', {
            collection,
          })
        );
        return { lastModified: 0 };
      });

    const clearCheckpoint = (collection: string) =>
      Effect.gen(function* (_) {
        const key = `checkpoint:${collection}`;
        yield* _(idb.delete(key));
        yield* _(Effect.logDebug('Checkpoint cleared', { collection }));
      });

    return CheckpointService.of({
      loadCheckpoint,

      saveCheckpoint: (collection, checkpoint) =>
        Effect.gen(function* (_) {
          const key = `checkpoint:${collection}`;
          yield* _(idb.set(key, checkpoint));
          yield* _(
            Effect.logDebug('Checkpoint saved', {
              collection,
              checkpoint,
            })
          );
        }),

      clearCheckpoint,

      loadCheckpointWithStaleDetection: (collection, hasSSRData) =>
        Effect.gen(function* (_) {
          // If we have SSR data, always start fresh (lastModified: 0)
          // to sync from the SSR snapshot point
          if (hasSSRData) {
            yield* _(
              Effect.logDebug('Using fresh checkpoint due to SSR data', {
                collection,
              })
            );
            return { lastModified: 0 };
          }

          // Normal case: load stored checkpoint
          // This works correctly because:
          // - Yjs IndexedDB persistence is independent from checkpoint tracking
          // - Checkpoint tracks subscription position (what we've received from server)
          // - Yjs tracks document state (CRDT)
          // - Both should work together, not conflict
          return yield* _(loadCheckpoint(collection));
        }),
    });
  })
);
