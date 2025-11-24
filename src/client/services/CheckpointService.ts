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
      hasSSRData: boolean,
      hasPersistedYjsState: boolean
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

      loadCheckpointWithStaleDetection: (collection, hasSSRData, hasPersistedYjsState) =>
        Effect.gen(function* (_) {
          // If we have SSR data, always start fresh (lastModified: 0)
          if (hasSSRData) {
            yield* _(
              Effect.logDebug('Using fresh checkpoint due to SSR data', {
                collection,
              })
            );
            return { lastModified: 0 };
          }

          // Detect stale checkpoint scenario:
          // Yjs loaded persisted state from IndexedDB, but no SSR data provided
          // This means checkpoint might be ahead of what we have, causing missed updates
          if (hasPersistedYjsState) {
            yield* _(
              Effect.logDebug('Clearing stale checkpoint due to persisted Yjs state', {
                collection,
              })
            );
            yield* _(clearCheckpoint(collection));
            return { lastModified: 0 };
          }

          // Normal case: load stored checkpoint
          return yield* _(loadCheckpoint(collection));
        }),
    });
  })
);
