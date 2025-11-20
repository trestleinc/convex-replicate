import { Effect, Context, Layer, Ref } from 'effect';

// Connection state ADT - using manual discriminated union
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

// Service definition
export class ConnectionService extends Context.Tag('ConnectionService')<
  ConnectionService,
  {
    readonly state: Ref.Ref<ConnectionStateValue>;
    readonly getState: Effect.Effect<ConnectionStateValue>;
    readonly setState: (state: ConnectionStateValue) => Effect.Effect<void>;
    readonly isConnected: Effect.Effect<boolean>;
    readonly waitForConnection: Effect.Effect<void>;
  }
>() {}

// Service implementation
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
    });
  })
);
