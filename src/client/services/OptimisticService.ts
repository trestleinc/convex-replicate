import { Effect, Context, Layer, Data } from 'effect';

export class OptimisticWriteError extends Data.TaggedError('OptimisticWriteError')<{
  operation: 'insert' | 'update' | 'delete' | 'truncate';
  cause: unknown;
}> {}

export interface SyncParams {
  readonly begin: () => void;
  readonly write: (message: any) => void;
  readonly commit: () => void;
  readonly truncate: () => void;
}

export class OptimisticService extends Context.Tag('OptimisticService')<
  OptimisticService,
  {
    readonly initialize: (params: SyncParams) => Effect.Effect<void, never>;
    readonly insert: <T>(items: T[]) => Effect.Effect<void, OptimisticWriteError>;
    readonly update: <T>(items: T[]) => Effect.Effect<void, OptimisticWriteError>;
    readonly delete: <T>(items: T[]) => Effect.Effect<void, OptimisticWriteError>;
    readonly upsert: <T>(items: T[]) => Effect.Effect<void, OptimisticWriteError>;
    readonly truncate: () => Effect.Effect<void, OptimisticWriteError>;
    readonly replaceAll: <T>(items: T[]) => Effect.Effect<void, OptimisticWriteError>;
  }
>() {}

export const OptimisticServiceLive = Layer.effect(
  OptimisticService,
  Effect.gen(function* (_) {
    let syncParams: SyncParams | null = null;

    const ensureInitialized = (): Effect.Effect<SyncParams, OptimisticWriteError> =>
      Effect.gen(function* (_) {
        if (!syncParams) {
          return yield* _(
            Effect.fail(
              new OptimisticWriteError({
                operation: 'insert',
                cause: new Error('OptimisticService not initialized - call initialize() first'),
              })
            )
          );
        }
        return syncParams;
      });

    return OptimisticService.of({
      initialize: (params) =>
        Effect.sync(() => {
          syncParams = params;
        }),

      insert: (items) =>
        Effect.gen(function* (_) {
          const params = yield* _(ensureInitialized());

          return yield* _(
            Effect.try({
              try: () => {
                params.begin();
                for (const item of items) {
                  params.write({ type: 'insert', value: item });
                }
                params.commit();
              },
              catch: (cause) =>
                new OptimisticWriteError({
                  operation: 'insert',
                  cause,
                }),
            })
          );
        }),

      update: (items) =>
        Effect.gen(function* (_) {
          const params = yield* _(ensureInitialized());

          return yield* _(
            Effect.try({
              try: () => {
                params.begin();
                for (const item of items) {
                  params.write({ type: 'update', value: item });
                }
                params.commit();
              },
              catch: (cause) =>
                new OptimisticWriteError({
                  operation: 'update',
                  cause,
                }),
            })
          );
        }),

      delete: (items) =>
        Effect.gen(function* (_) {
          const params = yield* _(ensureInitialized());

          return yield* _(
            Effect.try({
              try: () => {
                params.begin();
                for (const item of items) {
                  params.write({ type: 'delete', value: item });
                }
                params.commit();
              },
              catch: (cause) =>
                new OptimisticWriteError({
                  operation: 'delete',
                  cause,
                }),
            })
          );
        }),

      upsert: (items) =>
        Effect.gen(function* (_) {
          const params = yield* _(ensureInitialized());

          return yield* _(
            Effect.try({
              try: () => {
                params.begin();
                for (const item of items) {
                  try {
                    params.write({ type: 'update', value: item });
                  } catch {
                    params.write({ type: 'insert', value: item });
                  }
                }
                params.commit();
              },
              catch: (cause) =>
                new OptimisticWriteError({
                  operation: 'update',
                  cause,
                }),
            })
          );
        }),

      truncate: () =>
        Effect.gen(function* (_) {
          const params = yield* _(ensureInitialized());

          return yield* _(
            Effect.try({
              try: () => {
                params.truncate();
              },
              catch: (cause) =>
                new OptimisticWriteError({
                  operation: 'truncate',
                  cause,
                }),
            })
          );
        }),

      replaceAll: (items) =>
        Effect.gen(function* (_) {
          const params = yield* _(ensureInitialized());

          return yield* _(
            Effect.try({
              try: () => {
                params.truncate();
                params.begin();
                for (const item of items) {
                  params.write({ type: 'insert', value: item });
                }
                params.commit();
              },
              catch: (cause) =>
                new OptimisticWriteError({
                  operation: 'truncate',
                  cause,
                }),
            })
          );
        }),
    });
  })
);
