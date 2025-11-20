import { Effect, Context, Layer, Ref } from 'effect';
import { TabCoordinationError } from '../errors';

// Service definition
export class TabLeaderService extends Context.Tag('TabLeaderService')<
  TabLeaderService,
  {
    readonly isLeader: Effect.Effect<boolean>;
    readonly requestLeadership: Effect.Effect<void, TabCoordinationError>;
    readonly releaseLeadership: Effect.Effect<void, TabCoordinationError>;
  }
>() {}

// Service implementation (BroadcastChannel-based leader election)
export const TabLeaderServiceLive = Layer.effect(
  TabLeaderService,
  Effect.gen(function* (_) {
    const isLeaderRef = yield* _(Ref.make(false));
    const tabId = Math.random().toString(36);

    // Create BroadcastChannel for coordination
    const channel = typeof window !== 'undefined' ? new BroadcastChannel('replicate-leader') : null;

    return TabLeaderService.of({
      isLeader: Ref.get(isLeaderRef),

      requestLeadership: !channel
        ? // SSR or no BroadcastChannel support - assume leadership
          Effect.gen(function* (_) {
            yield* _(Ref.set(isLeaderRef, true));
          })
        : // Leader election protocol
          Effect.gen(function* (_) {
            yield* _(
              Effect.try({
                try: () => {
                  channel.postMessage({ type: 'request_leadership', tabId });
                },
                catch: (cause) =>
                  new TabCoordinationError({
                    operation: 'leader_election',
                    cause,
                  }),
              })
            );

            // Wait for responses
            yield* _(Effect.sleep('100 millis'));

            // If no one objected, become leader
            yield* _(Ref.set(isLeaderRef, true));
            yield* _(Effect.logInfo('Tab became leader', { tabId }));
          }),

      releaseLeadership: !channel
        ? // SSR or no BroadcastChannel support
          Effect.gen(function* (_) {
            yield* _(Ref.set(isLeaderRef, false));
          })
        : Effect.gen(function* (_) {
            yield* _(Ref.set(isLeaderRef, false));

            yield* _(
              Effect.try({
                try: () => {
                  channel.postMessage({ type: 'release_leadership', tabId });
                },
                catch: (cause) =>
                  new TabCoordinationError({
                    operation: 'message_broadcast',
                    cause,
                  }),
              })
            );

            yield* _(Effect.logInfo('Tab released leadership', { tabId }));
          }),
    });
  })
);
