import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import {
  SubscriptionService,
  SubscriptionServiceLive,
} from '../../client/services/SubscriptionService.js';
import {
  createMockSubscriptionHandler,
  createTestSubscriptionConfig,
  createTestSubscriptionResponse,
  createTestCheckpoint,
} from '../utils/subscription-fixtures.js';
import { flushEffectPromises } from '../utils/effect-test-helpers.js';

describe('SubscriptionService', () => {
  // ============================================
  // SUBSCRIPTION LIFECYCLE
  // ============================================
  describe('Subscription Lifecycle', () => {
    describe('when initializing the service', () => {
      it('stores configuration for later use', async () => {
        const { config } = createTestSubscriptionConfig();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);

            // Verify initialization succeeded by checking we can create a subscription
            const { handler } = createMockSubscriptionHandler();
            const cleanup = yield* svc.create(createTestCheckpoint(), handler);
            expect(typeof cleanup).toBe('function');
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );
      });

      it('can be called multiple times (overwrites config)', async () => {
        const { config: config1 } = createTestSubscriptionConfig({ collection: 'col1' });
        const { config: config2, mockClient: mockClient2 } = createTestSubscriptionConfig({
          collection: 'col2',
        });

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config1);
            yield* svc.initialize(config2);

            // Should use the second config
            const { handler } = createMockSubscriptionHandler();
            yield* svc.create(createTestCheckpoint(), handler);

            expect(mockClient2.onUpdate).toHaveBeenCalled();
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );
      });
    });

    describe('when creating a subscription', () => {
      it('calls convexClient.onUpdate with correct arguments', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();
        const checkpoint = createTestCheckpoint(12345);

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);

            const { handler } = createMockSubscriptionHandler();
            yield* svc.create(checkpoint, handler);

            expect(mockClient.onUpdate).toHaveBeenCalledTimes(1);
            expect(mockClient.onUpdate).toHaveBeenCalledWith(
              config.api,
              { checkpoint, limit: 100 },
              expect.any(Function)
            );
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );
      });

      it('stores the handler for potential recreation', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();
        const { handler, calls } = createMockSubscriptionHandler();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);
            yield* svc.create(createTestCheckpoint(), handler);

            // Recreate should work because handler is stored
            yield* svc.recreate(createTestCheckpoint(999));
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );

        // Trigger update and verify same handler receives it
        const response = createTestSubscriptionResponse({ documentId: 'test-doc' });
        mockClient._triggerUpdate(response);
        await flushEffectPromises();

        expect(calls).toHaveLength(1);
      });

      it('returns a cleanup function', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);

            const { handler } = createMockSubscriptionHandler();
            const cleanup = yield* svc.create(createTestCheckpoint(), handler);

            expect(typeof cleanup).toBe('function');
            expect(mockClient._getActiveSubscriptions()).toBe(1);

            cleanup();
            expect(mockClient._getActiveSubscriptions()).toBe(0);
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );
      });

      it('cleans up existing subscription before creating new one', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);

            const { handler: handler1 } = createMockSubscriptionHandler();
            const { handler: handler2 } = createMockSubscriptionHandler();

            yield* svc.create(createTestCheckpoint(), handler1);
            expect(mockClient._getActiveSubscriptions()).toBe(1);

            yield* svc.create(createTestCheckpoint(100), handler2);
            // Old subscription should be cleaned up
            expect(mockClient._getActiveSubscriptions()).toBe(1);
            expect(mockClient._cleanup).toHaveBeenCalled();
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );
      });
    });

    describe('when recreating a subscription', () => {
      it('uses stored handler from previous creation', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();
        const { handler, calls } = createMockSubscriptionHandler();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);

            yield* svc.create(createTestCheckpoint(), handler);
            yield* svc.recreate(createTestCheckpoint(999));
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );

        // Should still receive updates via stored handler
        const response = createTestSubscriptionResponse();
        mockClient._triggerUpdate(response);
        await flushEffectPromises();

        expect(calls).toHaveLength(1);
      });

      it('cleans up existing subscription before recreating', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);

            const { handler } = createMockSubscriptionHandler();
            yield* svc.create(createTestCheckpoint(), handler);
            mockClient._cleanup.mockClear();

            yield* svc.recreate(createTestCheckpoint(999));

            expect(mockClient._cleanup).toHaveBeenCalled();
            expect(mockClient._getActiveSubscriptions()).toBe(1);
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );
      });

      it('creates subscription with new checkpoint', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();
        const newCheckpoint = createTestCheckpoint(999);

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);

            const { handler } = createMockSubscriptionHandler();
            yield* svc.create(createTestCheckpoint(0), handler);
            mockClient.onUpdate.mockClear();

            yield* svc.recreate(newCheckpoint);

            expect(mockClient.onUpdate).toHaveBeenCalledWith(
              config.api,
              { checkpoint: newCheckpoint, limit: 100 },
              expect.any(Function)
            );
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );
      });
    });

    describe('when cleaning up', () => {
      it('calls the cleanup function from onUpdate', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);

            const { handler } = createMockSubscriptionHandler();
            yield* svc.create(createTestCheckpoint(), handler);

            yield* svc.cleanup();

            expect(mockClient._cleanup).toHaveBeenCalled();
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );
      });

      it('sets subscription ref to null', async () => {
        const { config } = createTestSubscriptionConfig();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);

            const { handler } = createMockSubscriptionHandler();
            yield* svc.create(createTestCheckpoint(), handler);

            expect(yield* svc.isActive).toBe(true);

            yield* svc.cleanup();

            expect(yield* svc.isActive).toBe(false);
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );
      });

      it('does nothing when no active subscription exists', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);

            // Call cleanup without creating subscription
            yield* svc.cleanup();
            yield* svc.cleanup(); // Call twice

            // Should not throw
            expect(mockClient._cleanup).not.toHaveBeenCalled();
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );
      });
    });

    describe('when checking isActive', () => {
      it('returns false when no subscription exists', async () => {
        const { config } = createTestSubscriptionConfig();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);

            expect(yield* svc.isActive).toBe(false);
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );
      });

      it('returns true after creating a subscription', async () => {
        const { config } = createTestSubscriptionConfig();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);

            const { handler } = createMockSubscriptionHandler();
            yield* svc.create(createTestCheckpoint(), handler);

            expect(yield* svc.isActive).toBe(true);
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );
      });

      it('returns false after cleanup', async () => {
        const { config } = createTestSubscriptionConfig();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);

            const { handler } = createMockSubscriptionHandler();
            yield* svc.create(createTestCheckpoint(), handler);
            yield* svc.cleanup();

            expect(yield* svc.isActive).toBe(false);
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );
      });
    });
  });

  // ============================================
  // ERROR HANDLING
  // ============================================
  describe('Error Handling', () => {
    describe('when service is not initialized', () => {
      it('fails create with SubscriptionError', async () => {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            const { handler } = createMockSubscriptionHandler();
            return yield* svc.create(createTestCheckpoint(), handler);
          }).pipe(Effect.provide(SubscriptionServiceLive), Effect.either)
        );

        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left._tag).toBe('SubscriptionError');
          expect(result.left.operation).toBe('ensureInitialized');
        }
      });

      it('fails recreate with SubscriptionError', async () => {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            return yield* svc.recreate(createTestCheckpoint());
          }).pipe(Effect.provide(SubscriptionServiceLive), Effect.either)
        );

        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left._tag).toBe('SubscriptionError');
          expect(result.left.operation).toBe('ensureInitialized');
        }
      });
    });

    describe('when handler is missing for recreate', () => {
      it('fails with SubscriptionError', async () => {
        const { config } = createTestSubscriptionConfig();

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);
            // Don't call create() - no handler stored
            return yield* svc.recreate(createTestCheckpoint());
          }).pipe(Effect.provide(SubscriptionServiceLive), Effect.either)
        );

        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left._tag).toBe('SubscriptionError');
          expect(result.left.operation).toBe('recreate');
        }
      });
    });

    describe('when convexClient.onUpdate throws', () => {
      it('wraps error in SubscriptionError for create', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();
        mockClient.onUpdate.mockImplementation(() => {
          throw new Error('Connection failed');
        });

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);
            const { handler } = createMockSubscriptionHandler();
            return yield* svc.create(createTestCheckpoint(), handler);
          }).pipe(Effect.provide(SubscriptionServiceLive), Effect.either)
        );

        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left._tag).toBe('SubscriptionError');
          expect(result.left.operation).toBe('create');
        }
      });

      it('wraps error in SubscriptionError for recreate', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();
        const { handler } = createMockSubscriptionHandler();

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);
            yield* svc.create(createTestCheckpoint(), handler);

            // Make onUpdate throw on recreate
            mockClient.onUpdate.mockImplementation(() => {
              throw new Error('Connection failed');
            });

            return yield* svc.recreate(createTestCheckpoint(999));
          }).pipe(Effect.provide(SubscriptionServiceLive), Effect.either)
        );

        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left._tag).toBe('SubscriptionError');
          expect(result.left.operation).toBe('recreate');
        }
      });
    });
  });

  // ============================================
  // HANDLER INVOCATION
  // ============================================
  describe('Handler Invocation', () => {
    describe('when server sends updates', () => {
      it('invokes handler with response from server', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();
        const { handler, calls } = createMockSubscriptionHandler();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);
            yield* svc.create(createTestCheckpoint(), handler);
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );

        const response = createTestSubscriptionResponse({
          operationType: 'delta',
          documentId: 'doc-123',
        });
        mockClient._triggerUpdate(response);
        await flushEffectPromises();

        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual(response);
      });

      it('handles multiple rapid updates', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();
        const { handler, calls } = createMockSubscriptionHandler();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);
            yield* svc.create(createTestCheckpoint(), handler);
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );

        // Send 10 rapid updates
        for (let i = 0; i < 10; i++) {
          mockClient._triggerUpdate(createTestSubscriptionResponse({ documentId: `doc-${i}` }));
        }
        await flushEffectPromises(100);

        expect(calls).toHaveLength(10);
      });
    });

    describe('when handler throws errors', () => {
      it('catches errors and does not break subscription', async () => {
        const { config, mockClient } = createTestSubscriptionConfig();
        const { handler, calls, failOnNext } = createMockSubscriptionHandler();

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SubscriptionService;
            yield* svc.initialize(config);
            yield* svc.create(createTestCheckpoint(), handler);
          }).pipe(Effect.provide(SubscriptionServiceLive))
        );

        // First call will fail
        failOnNext();
        mockClient._triggerUpdate(createTestSubscriptionResponse({ documentId: 'doc-1' }));
        await flushEffectPromises();

        // Second call should still work
        mockClient._triggerUpdate(createTestSubscriptionResponse({ documentId: 'doc-2' }));
        await flushEffectPromises();

        // Both calls should have been attempted - subscription wasn't broken by error
        expect(calls).toHaveLength(2);

        // Verify both documents were received (proving second update worked after error)
        expect(calls[0].changes[0].documentId).toBe('doc-1');
        expect(calls[1].changes[0].documentId).toBe('doc-2');
      });
    });
  });
});
