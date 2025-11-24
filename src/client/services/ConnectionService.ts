import { Effect, Context, Layer, Ref } from 'effect';
import type { SyncSystemError } from './errors.js';

export type ConnectionStateValue =
  | { readonly _tag: 'Disconnected' }
  | { readonly _tag: 'Connecting' }
  | { readonly _tag: 'Connected'; readonly since: number }
  | { readonly _tag: 'Reconnecting'; readonly attempt: number; readonly lastError?: unknown }
  | { readonly _tag: 'Failed'; readonly error: unknown; readonly nextRetryAt: number };

export const ConnectionState = {
  Disconnected: (): ConnectionStateValue => ({ _tag: 'Disconnected' }),
  Connecting: (): ConnectionStateValue => ({ _tag: 'Connecting' }),
  Connected: (since: number): ConnectionStateValue => ({
    _tag: 'Connected',
    since,
  }),
  Reconnecting: (attempt: number, lastError?: unknown): ConnectionStateValue => ({
    _tag: 'Reconnecting',
    attempt,
    lastError,
  }),
  Failed: (error: unknown, nextRetryAt: number): ConnectionStateValue => ({
    _tag: 'Failed',
    error,
    nextRetryAt,
  }),
};

export interface ConnectionHandlers {
  onOnline?: () => Effect.Effect<void, SyncSystemError>;
  onOffline?: () => Effect.Effect<void, SyncSystemError>;
  onVisibilityChange?: (visible: boolean) => Effect.Effect<void, SyncSystemError>;
}

export class ConnectionService extends Context.Tag('ConnectionService')<
  ConnectionService,
  {
    readonly state: Ref.Ref<ConnectionStateValue>;
    readonly getState: Effect.Effect<ConnectionStateValue>;
    readonly setState: (state: ConnectionStateValue) => Effect.Effect<void>;
    readonly isConnected: Effect.Effect<boolean>;
    readonly waitForConnection: Effect.Effect<void>;
    readonly startMonitoring: (handlers?: ConnectionHandlers) => Effect.Effect<() => void, never>;
  }
>() {}

export const ConnectionServiceLive = Layer.effect(
  ConnectionService,
  Effect.gen(function* (_) {
    const stateRef = yield* _(Ref.make(ConnectionState.Disconnected()));

    return ConnectionService.of({
      state: stateRef,
      getState: Ref.get(stateRef),
      setState: (newState: ConnectionStateValue) =>
        Effect.gen(function* (_) {
          const oldState = yield* _(Ref.get(stateRef));
          yield* _(Ref.set(stateRef, newState));

          // Log state transitions
          yield* _(
            Effect.logDebug('Connection state transition', {
              from: oldState._tag,
              to: newState._tag,
            })
          );
        }),
      isConnected: Effect.gen(function* (_) {
        const state = yield* _(Ref.get(stateRef));
        return state._tag === 'Connected';
      }),
      waitForConnection: Effect.gen(function* (_) {
        yield* _(
          Effect.repeat(
            Effect.gen(function* (_) {
              const state = yield* _(Ref.get(stateRef));
              if (state._tag === 'Connected') {
                return true;
              }
              yield* _(Effect.sleep('100 millis'));
              return false;
            }),
            {
              until: (isConnected) => isConnected,
            }
          ).pipe(Effect.timeout('30 seconds'), Effect.orDie)
        );
      }),

      startMonitoring: (handlers) =>
        Effect.sync(() => {
          if (typeof window === 'undefined') {
            return () => {};
          }

          const cleanupFns: Array<() => void> = [];

          // Online event
          const handleOnline = () => {
            Effect.runPromise(
              Effect.gen(function* (_) {
                yield* _(Ref.set(stateRef, ConnectionState.Connected(Date.now())));
                yield* _(Effect.logInfo('Network online detected'));
                if (handlers?.onOnline) {
                  yield* _(handlers.onOnline());
                }
              }).pipe(
                Effect.catchAllCause((cause) => Effect.logError('Online handler error', { cause }))
              )
            );
          };

          // Offline event
          const handleOffline = () => {
            Effect.runPromise(
              Effect.gen(function* (_) {
                yield* _(Ref.set(stateRef, ConnectionState.Disconnected()));
                yield* _(Effect.logWarning('Network offline detected'));
                if (handlers?.onOffline) {
                  yield* _(handlers.onOffline());
                }
              }).pipe(
                Effect.catchAllCause((cause) => Effect.logError('Offline handler error', { cause }))
              )
            );
          };

          // Visibility change
          const handleVisibilityChange = () => {
            const isVisible = document.visibilityState === 'visible';
            Effect.runPromise(
              Effect.gen(function* (_) {
                yield* _(
                  Effect.logDebug('Visibility changed', {
                    visible: isVisible,
                  })
                );
                if (handlers?.onVisibilityChange) {
                  yield* _(handlers.onVisibilityChange(isVisible));
                }
              }).pipe(
                Effect.catchAllCause((cause) =>
                  Effect.logError('Visibility change handler error', { cause })
                )
              )
            );
          };

          window.addEventListener('online', handleOnline);
          window.addEventListener('offline', handleOffline);
          document.addEventListener('visibilitychange', handleVisibilityChange);

          cleanupFns.push(() => window.removeEventListener('online', handleOnline));
          cleanupFns.push(() => window.removeEventListener('offline', handleOffline));
          cleanupFns.push(() =>
            document.removeEventListener('visibilitychange', handleVisibilityChange)
          );

          // Return cleanup function
          return () => {
            for (const cleanup of cleanupFns) {
              cleanup();
            }
          };
        }),
    });
  })
);
