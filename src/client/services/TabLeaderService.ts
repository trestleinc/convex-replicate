import { Effect, Context, Layer, Ref } from 'effect';

// ============================================================================
// Message Protocol Types
// ============================================================================

type TabMessage =
  | { type: 'heartbeat'; tabId: string; timestamp: number }
  | { type: 'claim_leadership'; tabId: string; timestamp: number }
  | { type: 'relinquish_leadership'; tabId: string; reason?: string }
  | { type: 'leadership_challenge'; tabId: string; timestamp: number }
  | { type: 'ping'; tabId: string }
  | { type: 'pong'; tabId: string; respondingTo: string };

// Configuration constants
const LEADER_ELECTION_CONFIG = {
  HEARTBEAT_INTERVAL: 5000, // 5 seconds - leader sends heartbeat
  LEADER_TIMEOUT: 15000, // 15 seconds (3x heartbeat) - follower assumes leader dead
  ELECTION_DELAY: 1000, // 1 second - wait before claiming leadership
  CHALLENGE_TIMEOUT: 2000, // 2 seconds - wait for challenge response
} as const;

// ============================================================================
// Heartbeat Mechanism (leader only)
// ============================================================================

const startHeartbeat = (channel: BroadcastChannel, tabId: string, isLeaderRef: Ref.Ref<boolean>) =>
  Effect.gen(function* (_) {
    // Repeat heartbeat every HEARTBEAT_INTERVAL
    yield* _(
      Effect.gen(function* (_) {
        const isLeader = yield* _(Ref.get(isLeaderRef));

        if (!isLeader) {
          // No longer leader, stop heartbeat
          yield* _(Effect.logInfo('No longer leader, stopping heartbeat'));
          return yield* _(Effect.interrupt);
        }

        // Send heartbeat
        yield* _(
          Effect.sync(() => {
            channel.postMessage({
              type: 'heartbeat',
              tabId,
              timestamp: Date.now(),
            });
          })
        );

        yield* _(Effect.sleep(`${LEADER_ELECTION_CONFIG.HEARTBEAT_INTERVAL} millis`));
      }).pipe(
        Effect.forever,
        Effect.catchAll((error) => Effect.logError('Heartbeat error', error))
      )
    );
  }).pipe(
    Effect.forkDaemon // Run in background
  );

// ============================================================================
// Failover Logic (follower becomes leader)
// ============================================================================

const monitorLeaderHealth = (
  channel: BroadcastChannel,
  tabId: string,
  isLeaderRef: Ref.Ref<boolean>,
  lastHeartbeatRef: Ref.Ref<number>
) =>
  Effect.gen(function* (_) {
    yield* _(
      Effect.gen(function* (_) {
        const isLeader = yield* _(Ref.get(isLeaderRef));

        if (isLeader) {
          // We're leader, no need to monitor
          yield* _(Effect.sleep('5 seconds'));
          return;
        }

        // Check if leader is still alive
        const lastHeartbeat = yield* _(Ref.get(lastHeartbeatRef));
        const timeSinceHeartbeat = Date.now() - lastHeartbeat;

        if (timeSinceHeartbeat > LEADER_ELECTION_CONFIG.LEADER_TIMEOUT && lastHeartbeat !== 0) {
          yield* _(
            Effect.logWarning('Leader timeout detected, claiming leadership', {
              tabId,
              timeSinceHeartbeat,
            })
          );

          // Claim leadership
          yield* _(Ref.set(isLeaderRef, true));
          channel.postMessage({
            type: 'claim_leadership',
            tabId,
            timestamp: Date.now(),
          });

          // Start heartbeat
          yield* _(startHeartbeat(channel, tabId, isLeaderRef));

          // Initialize subscription (was not running as follower)
          yield* _(Effect.logInfo('Failover complete, initializing subscription'));
        }

        yield* _(Effect.sleep('5 seconds'));
      }).pipe(Effect.forever)
    );
  }).pipe(Effect.forkDaemon);

// ============================================================================
// Graceful Shutdown
// ============================================================================

const handleTabClose = (channel: BroadcastChannel, tabId: string, isLeaderRef: Ref.Ref<boolean>) =>
  Effect.gen(function* (_) {
    // Register beforeunload handler
    yield* _(
      Effect.sync(() => {
        window.addEventListener('beforeunload', () => {
          const isLeader = Effect.runSync(Ref.get(isLeaderRef));
          if (isLeader) {
            channel.postMessage({
              type: 'relinquish_leadership',
              tabId,
              reason: 'tab_closing',
            });
          }
        });
      })
    );

    // Also handle visibility change (tab backgrounded)
    yield* _(
      Effect.sync(() => {
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            // Tab backgrounded - consider relinquishing leadership
            // This is optional and depends on requirements
            Effect.runSync(Effect.logInfo('Tab backgrounded (still maintaining leadership)'));
          }
        });
      })
    );
  });

// ============================================================================
// Network Connectivity Monitoring
// ============================================================================

const monitorNetworkConnectivity = (
  channel: BroadcastChannel,
  tabId: string,
  isLeaderRef: Ref.Ref<boolean>
) =>
  Effect.gen(function* (_) {
    yield* _(
      Effect.sync(() => {
        window.addEventListener('offline', () => {
          Effect.runSync(
            Effect.gen(function* (_) {
              const isLeader = yield* _(Ref.get(isLeaderRef));
              if (isLeader) {
                yield* _(
                  Effect.logWarning(
                    'Network offline detected, relinquishing leadership proactively'
                  )
                );
                // Relinquish leadership proactively for faster failover
                yield* _(Ref.set(isLeaderRef, false));
                channel.postMessage({
                  type: 'relinquish_leadership',
                  tabId,
                  reason: 'network_offline',
                });
              }
            })
          );
        });

        window.addEventListener('online', () => {
          Effect.runSync(Effect.logInfo('Network back online'));
        });
      })
    );
  });

// ============================================================================
// Leader Election Algorithm
// ============================================================================

const initializeLeaderElection = () =>
  Effect.gen(function* (_) {
    const myTabId = yield* _(Effect.sync(() => crypto.randomUUID()));
    const isLeaderRef = yield* _(Ref.make(false));
    const lastHeartbeatRef = yield* _(Ref.make(0));

    // Create BroadcastChannel for coordination
    const channel = yield* _(
      Effect.sync(() =>
        typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('replicate-leader') : null
      )
    );

    if (!channel) {
      // Fallback: No BroadcastChannel support (Safari private mode)
      // This tab becomes leader by default (each tab operates independently)
      yield* _(
        Effect.logWarning(
          'BroadcastChannel not supported, tab will operate as leader (no coordination)'
        )
      );
      yield* _(Ref.set(isLeaderRef, true));
      return { tabId: myTabId, isLeader: true, channel: null, isLeaderRef, lastHeartbeatRef };
    }

    // Setup message listener
    yield* _(
      Effect.async<void>((_resume, _signal) => {
        channel.onmessage = (event: MessageEvent<TabMessage>) => {
          const message = event.data;

          if (message.type === 'heartbeat') {
            // Another tab is leader
            Effect.runSync(Ref.set(lastHeartbeatRef, Date.now()));
            Effect.runSync(Ref.set(isLeaderRef, false));
          } else if (message.type === 'claim_leadership') {
            // Another tab is claiming leadership
            if (message.tabId < myTabId) {
              // Lower tabId wins (lexicographic comparison)
              Effect.runSync(Ref.set(isLeaderRef, false));
            } else {
              // We have priority, challenge this claim
              channel.postMessage({
                type: 'leadership_challenge',
                tabId: myTabId,
                timestamp: Date.now(),
              });
            }
          } else if (message.type === 'leadership_challenge') {
            // Someone challenged our leadership claim
            const currentIsLeader = Effect.runSync(Ref.get(isLeaderRef));
            if (currentIsLeader && message.tabId < myTabId) {
              // Lower tabId wins, relinquish
              Effect.runSync(Ref.set(isLeaderRef, false));
              channel.postMessage({
                type: 'relinquish_leadership',
                tabId: myTabId,
                reason: 'challenged_by_lower_id',
              });
            }
          } else if (message.type === 'relinquish_leadership') {
            // A leader stepped down, maybe we should claim
            Effect.runSync(Ref.set(lastHeartbeatRef, 0));
          }
        };

        // Return cleanup effect
        return Effect.sync(() => {
          channel.close();
        });
      })
    );

    // Wait for election delay to see if leader exists
    yield* _(Effect.sleep(`${LEADER_ELECTION_CONFIG.ELECTION_DELAY} millis`));

    const lastHeartbeat = yield* _(Ref.get(lastHeartbeatRef));
    const timeSinceHeartbeat = Date.now() - lastHeartbeat;

    if (timeSinceHeartbeat > LEADER_ELECTION_CONFIG.LEADER_TIMEOUT || lastHeartbeat === 0) {
      // No leader detected, claim leadership
      yield* _(Ref.set(isLeaderRef, true));
      channel.postMessage({
        type: 'claim_leadership',
        tabId: myTabId,
        timestamp: Date.now(),
      });

      yield* _(Effect.logInfo('Claimed leadership', { tabId: myTabId }));

      // Start heartbeat
      yield* _(startHeartbeat(channel, myTabId, isLeaderRef));
    } else {
      yield* _(
        Effect.logInfo('Leader already exists, becoming follower', {
          tabId: myTabId,
          lastHeartbeat,
        })
      );
    }

    return { tabId: myTabId, channel, isLeaderRef, lastHeartbeatRef };
  });

// ============================================================================
// SSR Check
// ============================================================================

const isServerEnvironment = () =>
  Effect.sync(() => typeof window === 'undefined' || typeof BroadcastChannel === 'undefined');

const initializeLeaderElectionWithSSRCheck = () =>
  Effect.gen(function* (_) {
    const isServer = yield* _(isServerEnvironment());

    if (isServer) {
      yield* _(Effect.logInfo('Server environment detected, skipping leader election'));
      const isLeaderRef = yield* _(Ref.make(true));
      const lastHeartbeatRef = yield* _(Ref.make(0));
      return {
        isLeader: true, // Server always acts as "leader" for its own context
        channel: null,
        tabId: 'server',
        isLeaderRef,
        lastHeartbeatRef,
      };
    }

    return yield* _(initializeLeaderElection());
  });

// ============================================================================
// Service Definition
// ============================================================================

export class TabLeaderService extends Context.Tag('TabLeaderService')<
  TabLeaderService,
  {
    readonly isLeader: Effect.Effect<boolean>;
    readonly waitForLeadership: Effect.Effect<void>;
    readonly relinquishLeadership: Effect.Effect<void>;
    readonly getTabId: Effect.Effect<string>;
  }
>() {}

// ============================================================================
// Service Implementation
// ============================================================================

export const TabLeaderServiceLive = Layer.scoped(
  TabLeaderService,
  Effect.gen(function* (_) {
    const election = yield* _(initializeLeaderElectionWithSSRCheck());

    if (!election.channel) {
      // No channel (SSR or unsupported)
      return TabLeaderService.of({
        isLeader: Effect.succeed(true),
        waitForLeadership: Effect.void,
        relinquishLeadership: Effect.void,
        getTabId: Effect.succeed(election.tabId),
      });
    }

    // Start health monitoring (follower → leader failover)
    yield* _(
      monitorLeaderHealth(
        election.channel,
        election.tabId,
        election.isLeaderRef,
        election.lastHeartbeatRef
      )
    );

    // Setup graceful shutdown
    yield* _(handleTabClose(election.channel, election.tabId, election.isLeaderRef));

    // Monitor network connectivity
    yield* _(monitorNetworkConnectivity(election.channel, election.tabId, election.isLeaderRef));

    return TabLeaderService.of({
      isLeader: Ref.get(election.isLeaderRef),

      waitForLeadership: Effect.gen(function* (_) {
        yield* _(
          Effect.repeat(
            Effect.gen(function* (_) {
              const isLeader = yield* _(Ref.get(election.isLeaderRef));
              if (isLeader) {
                return true;
              }
              yield* _(Effect.sleep('100 millis'));
              return false;
            }),
            {
              until: (isLeader) => isLeader,
            }
          )
        );
      }),

      relinquishLeadership: Effect.gen(function* (_) {
        yield* _(Ref.set(election.isLeaderRef, false));

        if (election.channel) {
          yield* _(
            Effect.sync(() => {
              election.channel.postMessage({
                type: 'relinquish_leadership',
                tabId: election.tabId,
                reason: 'explicit_relinquish',
              });
            })
          );
        }

        yield* _(Effect.logInfo('Leadership relinquished', { tabId: election.tabId }));
      }),

      getTabId: Effect.succeed(election.tabId),
    });
  })
);
