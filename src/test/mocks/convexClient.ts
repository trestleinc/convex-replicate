/**
 * Mock Convex Client for Testing
 */

import { vi } from 'vitest';
import type { SubscriptionResponse } from '../../client/services/SubscriptionService.js';

export interface MockConvexClient {
  mutation: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
}

export function createMockConvexClient(): MockConvexClient {
  return {
    mutation: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

/**
 * Enhanced Mock Convex Client with onUpdate support for subscription testing
 */
export interface MockConvexClientWithSubscription extends MockConvexClient {
  onUpdate: ReturnType<typeof vi.fn>;

  // Test control methods
  _triggerUpdate: (response: SubscriptionResponse) => void;
  _getActiveSubscriptions: () => number;
  _cleanup: ReturnType<typeof vi.fn>;
  _getLastCallback: () => ((response: SubscriptionResponse) => void) | null;
}

export function createMockConvexClientWithSubscription(): MockConvexClientWithSubscription {
  const subscriptionCallbacks = new Map<number, (response: SubscriptionResponse) => void>();
  let subscriptionCounter = 0;
  let lastCallback: ((response: SubscriptionResponse) => void) | null = null;
  const cleanupFn = vi.fn();

  return {
    mutation: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn().mockReturnValue(() => {}),

    onUpdate: vi.fn((_api, _args, callback) => {
      const subId = ++subscriptionCounter;
      subscriptionCallbacks.set(subId, callback);
      lastCallback = callback;

      // Return cleanup function
      const cleanup = () => {
        subscriptionCallbacks.delete(subId);
        cleanupFn();
      };
      return cleanup;
    }),

    _triggerUpdate: (response: SubscriptionResponse) => {
      subscriptionCallbacks.forEach((cb) => {
        cb(response);
      });
    },

    _getActiveSubscriptions: () => subscriptionCallbacks.size,

    _cleanup: cleanupFn,

    _getLastCallback: () => lastCallback,
  };
}
