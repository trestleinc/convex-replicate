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
  }
>() {}

export const CheckpointServiceLive = Layer.effect(
  CheckpointService,
  Effect.gen(function* (_) {
    const idb = yield* _(IDBService);

    return CheckpointService.of({
      loadCheckpoint: (collection) =>
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
        }),

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

      clearCheckpoint: (collection) =>
        Effect.gen(function* (_) {
          const key = `checkpoint:${collection}`;
          yield* _(idb.delete(key));
          yield* _(Effect.logDebug('Checkpoint cleared', { collection }));
        }),
    });
  })
);
