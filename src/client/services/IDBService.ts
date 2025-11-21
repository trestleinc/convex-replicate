import { Effect, Context, Layer, Schedule } from 'effect';
import { get as idbGet, set as idbSet, del as idbDel, type UseStore } from 'idb-keyval';
import { IDBError, IDBWriteError } from '../errors';

export class IDBService extends Context.Tag('IDBService')<
  IDBService,
  {
    readonly get: <T>(key: string, store?: UseStore) => Effect.Effect<T | undefined, IDBError>;
    readonly set: <T>(
      key: string,
      value: T,
      store?: UseStore
    ) => Effect.Effect<void, IDBWriteError>;
    readonly delete: (key: string, store?: UseStore) => Effect.Effect<void, IDBError>;
    readonly clear: (store?: UseStore) => Effect.Effect<void, IDBError>;
  }
>() {}

export const IDBServiceLive = Layer.succeed(
  IDBService,
  IDBService.of({
    get: (key, store) =>
      Effect.tryPromise({
        try: () => idbGet(key, store),
        catch: (cause) =>
          new IDBError({
            operation: 'get',
            key,
            store: store?.toString(),
            cause,
          }),
      }).pipe(
        Effect.retry({
          times: 3,
          schedule: Schedule.exponential('100 millis'),
        }),
        Effect.timeout('5 seconds'),
        Effect.catchTag('TimeoutException', () =>
          Effect.fail(
            new IDBError({
              operation: 'get',
              key,
              store: store?.toString(),
              cause: new Error('Operation timed out after 5 seconds'),
            })
          )
        ),
        Effect.withSpan('idb.get', { attributes: { key } })
      ),

    set: (key, value, store) =>
      Effect.tryPromise({
        try: () => idbSet(key, value, store),
        catch: (cause) => new IDBWriteError({ key, value, cause }),
      }).pipe(
        Effect.retry({
          times: 5,
          schedule: Schedule.exponential('200 millis'),
        }),
        Effect.timeout('10 seconds'),
        Effect.catchTag('TimeoutException', () =>
          Effect.fail(
            new IDBWriteError({
              key,
              value,
              cause: new Error('Operation timed out after 10 seconds'),
            })
          )
        ),
        Effect.withSpan('idb.set', { attributes: { key } })
      ),

    delete: (key, store) =>
      Effect.tryPromise({
        try: () => idbDel(key, store),
        catch: (cause) =>
          new IDBError({
            operation: 'delete',
            key,
            store: store?.toString(),
            cause,
          }),
      }).pipe(
        Effect.retry({ times: 3 }),
        Effect.timeout('5 seconds'),
        Effect.catchTag('TimeoutException', () =>
          Effect.fail(
            new IDBError({
              operation: 'delete',
              key,
              store: store?.toString(),
              cause: new Error('Operation timed out after 5 seconds'),
            })
          )
        )
      ),

    clear: (store) =>
      Effect.tryPromise({
        try: () => (store as any).clear(),
        catch: (cause) =>
          new IDBError({
            operation: 'clear',
            store: store?.toString(),
            cause,
          }),
      }).pipe(
        Effect.timeout('10 seconds'),
        Effect.catchTag('TimeoutException', () =>
          Effect.fail(
            new IDBError({
              operation: 'clear',
              store: store?.toString(),
              cause: new Error('Operation timed out after 10 seconds'),
            })
          )
        )
      ),
  })
);
