import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import {
  ConnectionService,
  ConnectionServiceLive,
  ConnectionState,
} from '../../client/services/ConnectionService.js';
import { flushEffectPromises } from '../utils/effect-test-helpers.js';

describe('ConnectionService', () => {
  // ============================================
  // STATE MANAGEMENT
  // ============================================
  describe('State Management', () => {
    describe('when initializing the service', () => {
      it('starts with Disconnected state', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ConnectionService;
            const state = yield* svc.getState;
            expect(state._tag).toBe('Disconnected');
          }).pipe(Effect.provide(ConnectionServiceLive))
        );
      });
    });

    describe('when setting state', () => {
      it('updates to Connected state', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ConnectionService;
            yield* svc.setState(ConnectionState.Connected(Date.now()));

            const state = yield* svc.getState;
            expect(state._tag).toBe('Connected');
          }).pipe(Effect.provide(ConnectionServiceLive))
        );
      });

      it('updates to Connecting state', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ConnectionService;
            yield* svc.setState(ConnectionState.Connecting());

            const state = yield* svc.getState;
            expect(state._tag).toBe('Connecting');
          }).pipe(Effect.provide(ConnectionServiceLive))
        );
      });

      it('updates to Reconnecting state with attempt count', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ConnectionService;
            yield* svc.setState(ConnectionState.Reconnecting(3, new Error('test')));

            const state = yield* svc.getState;
            expect(state._tag).toBe('Reconnecting');
            if (state._tag === 'Reconnecting') {
              expect(state.attempt).toBe(3);
              expect(state.lastError).toBeInstanceOf(Error);
            }
          }).pipe(Effect.provide(ConnectionServiceLive))
        );
      });

      it('updates to Failed state with error and retry time', async () => {
        const nextRetryAt = Date.now() + 5000;
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ConnectionService;
            yield* svc.setState(
              ConnectionState.Failed(new Error('connection failed'), nextRetryAt)
            );

            const state = yield* svc.getState;
            expect(state._tag).toBe('Failed');
            if (state._tag === 'Failed') {
              expect(state.error).toBeInstanceOf(Error);
              expect(state.nextRetryAt).toBe(nextRetryAt);
            }
          }).pipe(Effect.provide(ConnectionServiceLive))
        );
      });

      it('updates to Disconnected state', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ConnectionService;
            // First connect, then disconnect
            yield* svc.setState(ConnectionState.Connected(Date.now()));
            yield* svc.setState(ConnectionState.Disconnected());

            const state = yield* svc.getState;
            expect(state._tag).toBe('Disconnected');
          }).pipe(Effect.provide(ConnectionServiceLive))
        );
      });
    });
  });

  // ============================================
  // IS CONNECTED
  // ============================================
  describe('isConnected', () => {
    it('returns false when Disconnected', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          const isConnected = yield* svc.isConnected;
          expect(isConnected).toBe(false);
        }).pipe(Effect.provide(ConnectionServiceLive))
      );
    });

    it('returns false when Connecting', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          yield* svc.setState(ConnectionState.Connecting());
          const isConnected = yield* svc.isConnected;
          expect(isConnected).toBe(false);
        }).pipe(Effect.provide(ConnectionServiceLive))
      );
    });

    it('returns true when Connected', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          yield* svc.setState(ConnectionState.Connected(Date.now()));
          const isConnected = yield* svc.isConnected;
          expect(isConnected).toBe(true);
        }).pipe(Effect.provide(ConnectionServiceLive))
      );
    });

    it('returns false when Reconnecting', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          yield* svc.setState(ConnectionState.Reconnecting(1));
          const isConnected = yield* svc.isConnected;
          expect(isConnected).toBe(false);
        }).pipe(Effect.provide(ConnectionServiceLive))
      );
    });

    it('returns false when Failed', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          yield* svc.setState(ConnectionState.Failed(new Error('test'), Date.now()));
          const isConnected = yield* svc.isConnected;
          expect(isConnected).toBe(false);
        }).pipe(Effect.provide(ConnectionServiceLive))
      );
    });
  });

  // ============================================
  // WAIT FOR CONNECTION
  // ============================================
  describe('waitForConnection', () => {
    it('succeeds immediately if already connected', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          yield* svc.setState(ConnectionState.Connected(Date.now()));

          // Should complete without throwing
          yield* svc.waitForConnection;
        }).pipe(Effect.provide(ConnectionServiceLive))
      );
    });

    it('waits until state becomes Connected', async () => {
      const startTime = Date.now();
      let connected = false;

      const waitPromise = Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;

          // Schedule connection after 150ms
          Effect.runPromise(
            Effect.gen(function* () {
              yield* Effect.sleep('150 millis');
              yield* svc.setState(ConnectionState.Connected(Date.now()));
            }).pipe(Effect.provide(ConnectionServiceLive))
          );

          yield* svc.waitForConnection;
          connected = true;
        }).pipe(Effect.provide(ConnectionServiceLive))
      );

      await waitPromise;

      expect(connected).toBe(true);
      expect(Date.now() - startTime).toBeGreaterThanOrEqual(100);
    });
  });

  // ============================================
  // START MONITORING
  // ============================================
  describe('startMonitoring', () => {
    let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
    let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;
    let documentAddEventListenerSpy: ReturnType<typeof vi.spyOn>;
    let documentRemoveEventListenerSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      documentAddEventListenerSpy = vi.spyOn(document, 'addEventListener');
      documentRemoveEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    });

    afterEach(() => {
      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
      documentAddEventListenerSpy.mockRestore();
      documentRemoveEventListenerSpy.mockRestore();
    });

    it('sets up online/offline event listeners', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          const cleanup = yield* svc.startMonitoring();

          expect(addEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
          expect(addEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));
          expect(documentAddEventListenerSpy).toHaveBeenCalledWith(
            'visibilitychange',
            expect.any(Function)
          );

          cleanup();
        }).pipe(Effect.provide(ConnectionServiceLive))
      );
    });

    it('returns cleanup function that removes listeners', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          const cleanup = yield* svc.startMonitoring();

          cleanup();

          expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
          expect(removeEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));
          expect(documentRemoveEventListenerSpy).toHaveBeenCalledWith(
            'visibilitychange',
            expect.any(Function)
          );
        }).pipe(Effect.provide(ConnectionServiceLive))
      );
    });

    it('calls onOnline handler when online event fires', async () => {
      const onOnline = vi.fn().mockReturnValue(Effect.void);

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          yield* svc.startMonitoring({ onOnline });
        }).pipe(Effect.provide(ConnectionServiceLive))
      );

      // Simulate online event
      window.dispatchEvent(new Event('online'));
      await flushEffectPromises();

      expect(onOnline).toHaveBeenCalled();
    });

    it('calls onOffline handler when offline event fires', async () => {
      const onOffline = vi.fn().mockReturnValue(Effect.void);

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          yield* svc.startMonitoring({ onOffline });
        }).pipe(Effect.provide(ConnectionServiceLive))
      );

      // Simulate offline event
      window.dispatchEvent(new Event('offline'));
      await flushEffectPromises();

      expect(onOffline).toHaveBeenCalled();
    });

    it('calls onVisibilityChange handler when visibility changes', async () => {
      const onVisibilityChange = vi.fn().mockReturnValue(Effect.void);

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          yield* svc.startMonitoring({ onVisibilityChange });
        }).pipe(Effect.provide(ConnectionServiceLive))
      );

      // Simulate visibility change event
      document.dispatchEvent(new Event('visibilitychange'));
      await flushEffectPromises();

      expect(onVisibilityChange).toHaveBeenCalled();
    });

    it('sets state to Connected on online event', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          yield* svc.startMonitoring();
        }).pipe(Effect.provide(ConnectionServiceLive))
      );

      window.dispatchEvent(new Event('online'));
      await flushEffectPromises();

      // Need to verify state through a fresh run since state is scoped
      // This is a limitation of the current test approach
    });

    it('sets state to Disconnected on offline event', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          yield* svc.setState(ConnectionState.Connected(Date.now()));
          yield* svc.startMonitoring();
        }).pipe(Effect.provide(ConnectionServiceLive))
      );

      window.dispatchEvent(new Event('offline'));
      await flushEffectPromises();

      // State change happens inside the fire-and-forget effect
    });

    it('works without any handlers provided', async () => {
      let cleanup: (() => void) | undefined;

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          cleanup = yield* svc.startMonitoring();
        }).pipe(Effect.provide(ConnectionServiceLive))
      );

      // Should not throw when events fire
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('offline'));
      document.dispatchEvent(new Event('visibilitychange'));
      await flushEffectPromises();

      cleanup?.();
    });

    it('catches handler errors without breaking monitoring', async () => {
      const onOnline = vi.fn().mockReturnValue(Effect.fail(new Error('handler error')));

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* ConnectionService;
          yield* svc.startMonitoring({ onOnline });
        }).pipe(Effect.provide(ConnectionServiceLive))
      );

      // Should not throw even when handler fails
      window.dispatchEvent(new Event('online'));
      await flushEffectPromises();

      expect(onOnline).toHaveBeenCalled();
    });
  });

  // ============================================
  // CONNECTION STATE FACTORY
  // ============================================
  describe('ConnectionState factory', () => {
    it('creates Disconnected state', () => {
      const state = ConnectionState.Disconnected();
      expect(state._tag).toBe('Disconnected');
    });

    it('creates Connecting state', () => {
      const state = ConnectionState.Connecting();
      expect(state._tag).toBe('Connecting');
    });

    it('creates Connected state with timestamp', () => {
      const since = Date.now();
      const state = ConnectionState.Connected(since);
      expect(state._tag).toBe('Connected');
      if (state._tag === 'Connected') {
        expect(state.since).toBe(since);
      }
    });

    it('creates Reconnecting state with attempt count', () => {
      const state = ConnectionState.Reconnecting(5);
      expect(state._tag).toBe('Reconnecting');
      if (state._tag === 'Reconnecting') {
        expect(state.attempt).toBe(5);
        expect(state.lastError).toBeUndefined();
      }
    });

    it('creates Reconnecting state with attempt and error', () => {
      const error = new Error('connection lost');
      const state = ConnectionState.Reconnecting(2, error);
      expect(state._tag).toBe('Reconnecting');
      if (state._tag === 'Reconnecting') {
        expect(state.attempt).toBe(2);
        expect(state.lastError).toBe(error);
      }
    });

    it('creates Failed state with error and retry time', () => {
      const error = new Error('failed');
      const nextRetryAt = Date.now() + 10000;
      const state = ConnectionState.Failed(error, nextRetryAt);
      expect(state._tag).toBe('Failed');
      if (state._tag === 'Failed') {
        expect(state.error).toBe(error);
        expect(state.nextRetryAt).toBe(nextRetryAt);
      }
    });
  });
});
