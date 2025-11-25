/**
 * Subscription Testing Fixtures
 *
 * Factories and helpers for testing SubscriptionService
 */

import { Effect } from 'effect';
import type { FunctionReference } from 'convex/server';
import type {
  SubscriptionConfig,
  SubscriptionHandler,
  SubscriptionResponse,
  SubscriptionChange,
} from '../../client/services/SubscriptionService.js';
import type { Checkpoint } from '../../client/services/CheckpointService.js';
import { OrchestratorError } from '../../client/services/errors.js';
import { createMockConvexClientWithSubscription } from '../mocks/convexClient.js';

/**
 * Create a mock subscription handler that tracks calls
 */
export function createMockSubscriptionHandler(): {
  handler: SubscriptionHandler;
  calls: SubscriptionResponse[];
  failOnNext: () => void;
  reset: () => void;
} {
  const calls: SubscriptionResponse[] = [];
  let shouldFail = false;

  return {
    handler: (response: SubscriptionResponse) => {
      calls.push(response);
      if (shouldFail) {
        shouldFail = false; // Reset after one failure
        return Effect.fail(
          new OrchestratorError({
            operation: 'handler',
            message: 'Intentional test failure',
          })
        );
      }
      return Effect.void;
    },
    calls,
    failOnNext: () => {
      shouldFail = true;
    },
    reset: () => {
      calls.length = 0;
      shouldFail = false;
    },
  };
}

/**
 * Create a test subscription response
 */
export function createTestSubscriptionResponse(
  overrides?: Partial<{
    operationType: 'snapshot' | 'delta';
    documentId: string;
    crdtBytes: ArrayBuffer;
    lastModified: number;
  }>
): SubscriptionResponse {
  const change: SubscriptionChange = {
    operationType: overrides?.operationType ?? 'delta',
    documentId: overrides?.documentId,
    crdtBytes: overrides?.crdtBytes ?? new ArrayBuffer(8),
  };

  return {
    changes: [change],
    checkpoint: { lastModified: overrides?.lastModified ?? Date.now() },
  };
}

/**
 * Create a test subscription config
 */
export function createTestSubscriptionConfig(
  overrides?: Partial<{
    collection: string;
    mockClient: ReturnType<typeof createMockConvexClientWithSubscription>;
  }>
): {
  config: SubscriptionConfig;
  mockClient: ReturnType<typeof createMockConvexClientWithSubscription>;
} {
  const mockClient = overrides?.mockClient ?? createMockConvexClientWithSubscription();

  const config: SubscriptionConfig = {
    convexClient: mockClient as any,
    api: {} as FunctionReference<'query'>,
    collection: overrides?.collection ?? 'test-collection',
  };

  return { config, mockClient };
}

/**
 * Create a test checkpoint
 */
export function createTestCheckpoint(lastModified = 0): Checkpoint {
  return { lastModified };
}

/**
 * Create multiple subscription changes for testing batch scenarios
 */
export function createTestSubscriptionChanges(count: number): SubscriptionChange[] {
  return Array.from({ length: count }, (_, i) => ({
    operationType: 'delta' as const,
    documentId: `doc-${i}`,
    crdtBytes: new ArrayBuffer(8),
  }));
}
