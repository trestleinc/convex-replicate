import { Effect, Context, Layer } from 'effect';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { IDBError, IDBWriteError } from '$/client/errors.js';

export interface CheckpointData {
  lastModified: number;
}

export class Checkpoint extends Context.Tag('Checkpoint')<
  Checkpoint,
  {
    readonly loadCheckpoint: (collection: string) => Effect.Effect<CheckpointData, IDBError>;
    readonly saveCheckpoint: (
      collection: string,
      checkpoint: CheckpointData
    ) => Effect.Effect<void, IDBWriteError>;
    readonly clearCheckpoint: (collection: string) => Effect.Effect<void, IDBError>;
  }
>() {}

export const CheckpointLive = Layer.succeed(
  Checkpoint,
  Checkpoint.of({
    loadCheckpoint: (collection) =>
      Effect.gen(function* (_) {
        const key = `checkpoint:${collection}`;
        const stored = yield* _(
          Effect.tryPromise({
            try: () => idbGet<CheckpointData>(key),
            catch: (cause) => new IDBError({ operation: 'get', key, cause }),
          })
        );

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
        yield* _(
          Effect.tryPromise({
            try: () => idbSet(key, checkpoint),
            catch: (cause) => new IDBWriteError({ key, value: checkpoint, cause }),
          })
        );
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
        yield* _(
          Effect.tryPromise({
            try: () => idbDel(key),
            catch: (cause) => new IDBError({ operation: 'delete', key, cause }),
          })
        );
        yield* _(Effect.logDebug('Checkpoint cleared', { collection }));
      }),
  })
);
