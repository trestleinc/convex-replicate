/**
 * Mock Convex Client for Testing
 */

import { vi } from 'vitest';

// Define subscription types inline (no longer importing from SubscriptionService)
export interface SubscriptionChange {
  operationType: 'snapshot' | 'delta';
  documentId?: string;
  crdtBytes: ArrayBuffer;
}

export interface SubscriptionResponse {
  changes: SubscriptionChange[];
  checkpoint: { lastModified: number };
}

export interface MockConvexClient {
  mutation: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
}

export function createMockConvexClient(): MockConvexClient {
  return {
    mutation: vi.fn().mockResolvedValue(undefined),
    // Return { documents: [] } to match real Convex API response shape
    query: vi.fn().mockResolvedValue({ documents: [] }),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

/**
 * Enhanced Mock Convex Client with onUpdate support for subscription testing
 */
export interface SubscriptionCall {
  checkpoint: { lastModified: number };
  limit: number;
  callback: (response: SubscriptionResponse) => void;
}

export interface MockConvexClientWithSubscription extends MockConvexClient {
  onUpdate: ReturnType<typeof vi.fn>;

  // Test control methods
  _triggerUpdate: (response: SubscriptionResponse) => void;
  _getActiveSubscriptions: () => number;
  _cleanup: ReturnType<typeof vi.fn>;
  _getLastCallback: () => ((response: SubscriptionResponse) => void) | null;

  // NEW: Checkpoint tracking for debugging sync issues
  _getSubscriptionCalls: () => SubscriptionCall[];
  _getLastCheckpoint: () => { lastModified: number } | null;
  _getAllCheckpoints: () => { lastModified: number }[];
}

export function createMockConvexClientWithSubscription(): MockConvexClientWithSubscription {
  const subscriptionCallbacks = new Map<number, (response: SubscriptionResponse) => void>();
  let subscriptionCounter = 0;
  let lastCallback: ((response: SubscriptionResponse) => void) | null = null;
  const cleanupFn = vi.fn();

  // Track all subscription calls with their checkpoints
  const subscriptionCalls: SubscriptionCall[] = [];

  return {
    mutation: vi.fn().mockResolvedValue(undefined),
    // Return { documents: [] } to match real Convex API response shape
    query: vi.fn().mockResolvedValue({ documents: [] }),
    subscribe: vi.fn().mockReturnValue(() => {}),

    onUpdate: vi.fn((_api, args, callback) => {
      const subId = ++subscriptionCounter;
      subscriptionCallbacks.set(subId, callback);
      lastCallback = callback;

      // Track this subscription call with its checkpoint
      subscriptionCalls.push({
        checkpoint: args.checkpoint,
        limit: args.limit,
        callback,
      });

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

    // NEW: Get all subscription calls for inspection
    _getSubscriptionCalls: () => [...subscriptionCalls],

    // NEW: Get the checkpoint from the last subscription call
    _getLastCheckpoint: () => {
      if (subscriptionCalls.length === 0) return null;
      return subscriptionCalls[subscriptionCalls.length - 1].checkpoint;
    },

    // NEW: Get all checkpoints in order (useful for debugging)
    _getAllCheckpoints: () => subscriptionCalls.map((call) => call.checkpoint),
  };
}
