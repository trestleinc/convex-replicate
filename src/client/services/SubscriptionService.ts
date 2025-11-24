import { Effect, Context, Layer, Data, Ref } from 'effect';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import type { Checkpoint } from './CheckpointService';
import type { SyncSystemError } from './errors.js';

export class SubscriptionError extends Data.TaggedError('SubscriptionError')<{
  operation: string;
  cause: unknown;
}> {}

export interface SubscriptionChange {
  operationType: 'snapshot' | 'delta';
  documentId?: string;
  crdtBytes: ArrayBuffer;
}

export interface SubscriptionResponse {
  changes: SubscriptionChange[];
  checkpoint: Checkpoint;
}

export interface SubscriptionConfig {
  convexClient: ConvexClient;
  api: FunctionReference<'query'>;
  collection: string;
}

export type SubscriptionHandler = (
  response: SubscriptionResponse
) => Effect.Effect<void, SyncSystemError>;

export class SubscriptionService extends Context.Tag('SubscriptionService')<
  SubscriptionService,
  {
    readonly initialize: (config: SubscriptionConfig) => Effect.Effect<void, never>;
    readonly create: (
      checkpoint: Checkpoint,
      handler: SubscriptionHandler
    ) => Effect.Effect<() => void, SubscriptionError>;
    readonly recreate: (checkpoint: Checkpoint) => Effect.Effect<void, SubscriptionError>;
    readonly cleanup: () => Effect.Effect<void, never>;
    readonly isActive: Effect.Effect<boolean, never>;
  }
>() {}

export const SubscriptionServiceLive = Layer.effect(
  SubscriptionService,
  Effect.gen(function* (_) {
    const configRef = yield* _(Ref.make<SubscriptionConfig | null>(null));
    const subscriptionRef = yield* _(Ref.make<(() => void) | null>(null));
    const handlerRef = yield* _(Ref.make<SubscriptionHandler | null>(null));

    const ensureInitialized = (): Effect.Effect<SubscriptionConfig, SubscriptionError> =>
      Effect.gen(function* (_) {
        const config = yield* _(Ref.get(configRef));
        if (!config) {
          return yield* _(
            Effect.fail(
              new SubscriptionError({
                operation: 'ensureInitialized',
                cause: new Error('SubscriptionService not initialized'),
              })
            )
          );
        }
        return config;
      });

    return SubscriptionService.of({
      initialize: (config) =>
        Effect.gen(function* (_) {
          yield* _(Ref.set(configRef, config));
          yield* _(
            Effect.logInfo('SubscriptionService initialized', {
              collection: config.collection,
            })
          );
        }),

      create: (checkpoint, handler) =>
        Effect.gen(function* (_) {
          const config = yield* _(ensureInitialized());

          // Store handler for recreation
          yield* _(Ref.set(handlerRef, handler));

          // Cleanup existing subscription
          const existingCleanup = yield* _(Ref.get(subscriptionRef));
          if (existingCleanup) {
            yield* _(
              Effect.sync(() => {
                existingCleanup();
              })
            );
          }

          // Create new subscription
          const cleanup = yield* _(
            Effect.try({
              try: () => {
                return config.convexClient.onUpdate(
                  config.api,
                  {
                    checkpoint,
                    limit: 100,
                  },
                  (response: any) => {
                    // Run handler - fire and forget (Convex callback is sync)
                    Effect.runPromise(
                      handler(response).pipe(
                        Effect.catchAllCause((cause) =>
                          Effect.logError('Subscription handler error', { cause })
                        )
                      )
                    );
                  }
                );
              },
              catch: (cause) =>
                new SubscriptionError({
                  operation: 'create',
                  cause,
                }),
            })
          );

          yield* _(Ref.set(subscriptionRef, cleanup));
          yield* _(
            Effect.logInfo('Subscription created', {
              collection: config.collection,
              checkpoint,
            })
          );

          return cleanup;
        }),

      recreate: (checkpoint) =>
        Effect.gen(function* (_) {
          const config = yield* _(ensureInitialized());
          const handler = yield* _(Ref.get(handlerRef));

          if (!handler) {
            return yield* _(
              Effect.fail(
                new SubscriptionError({
                  operation: 'recreate',
                  cause: new Error('No handler stored - cannot recreate subscription'),
                })
              )
            );
          }

          // Cleanup existing subscription
          const existingCleanup = yield* _(Ref.get(subscriptionRef));
          if (existingCleanup) {
            yield* _(Effect.sync(() => existingCleanup()));
          }

          // Create new subscription
          const cleanup = yield* _(
            Effect.try({
              try: () => {
                return config.convexClient.onUpdate(
                  config.api,
                  { checkpoint, limit: 100 },
                  (response: any) => {
                    Effect.runPromise(
                      handler(response).pipe(
                        Effect.catchAllCause((cause) =>
                          Effect.logError('Subscription handler error', { cause })
                        )
                      )
                    );
                  }
                );
              },
              catch: (cause) =>
                new SubscriptionError({
                  operation: 'recreate',
                  cause,
                }),
            })
          );

          yield* _(Ref.set(subscriptionRef, cleanup));
          yield* _(Effect.logInfo('Subscription recreated', { checkpoint }));
        }),

      cleanup: () =>
        Effect.gen(function* (_) {
          const cleanup = yield* _(Ref.get(subscriptionRef));
          if (cleanup) {
            yield* _(
              Effect.sync(() => {
                cleanup();
              })
            );
            yield* _(Ref.set(subscriptionRef, null));
            yield* _(Effect.logInfo('Subscription cleaned up'));
          }
        }),

      isActive: Effect.gen(function* (_) {
        const cleanup = yield* _(Ref.get(subscriptionRef));
        return cleanup !== null;
      }),
    });
  })
);
