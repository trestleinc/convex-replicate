import { Effect, Context, Layer, Ref } from 'effect';

// Connection state ADT - using manual discriminated union
export type ConnectionStateValue =
  | { readonly _tag: 'Disconnected' }
  | { readonly _tag: 'Connecting' }
  | { readonly _tag: 'Connected'; readonly since: number }
  | { readonly _tag: 'Reconnecting'; readonly attempt: number }
  | { readonly _tag: 'Failed'; readonly error: unknown };

export const ConnectionState = {
  Disconnected: (): ConnectionStateValue => ({ _tag: 'Disconnected' }),
  Connecting: (): ConnectionStateValue => ({ _tag: 'Connecting' }),
  Connected: (since: number): ConnectionStateValue => ({
    _tag: 'Connected',
    since,
  }),
  Reconnecting: (attempt: number): ConnectionStateValue => ({
    _tag: 'Reconnecting',
    attempt,
  }),
  Failed: (error: unknown): ConnectionStateValue => ({ _tag: 'Failed', error }),
};

// Service definition
export class ConnectionService extends Context.Tag('ConnectionService')<
  ConnectionService,
  {
    readonly state: Ref.Ref<ConnectionStateValue>;
    readonly getState: Effect.Effect<ConnectionStateValue>;
    readonly setState: (state: ConnectionStateValue) => Effect.Effect<void>;
    readonly isConnected: Effect.Effect<boolean>;
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
      setState: (state) => Ref.set(stateRef, state),
      isConnected: Effect.gen(function* (_) {
        const state = yield* _(Ref.get(stateRef));
        return state._tag === 'Connected';
      }),
    });
  })
);
