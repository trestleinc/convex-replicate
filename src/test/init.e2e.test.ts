/**
 * End-to-end tests for protocol evolution and initialization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initConvexReplicate,
  getProtocolInfo,
  resetProtocolStorage,
  ensureInitialized,
  resetInitializationState,
} from '../client/init.js';
import { getStoredProtocolVersion, storeProtocolVersion } from '../client/protocol.js';

// Mock ConvexClient
class MockConvexClient {
  private responses: Map<string, any> = new Map();

  constructor(public url: string) {}

  // Set mock responses for testing
  setMockResponse(query: string, response: any) {
    this.responses.set(query, response);
  }

  async query(queryName: string): Promise<any> {
    const response = this.responses.get(queryName);
    if (!response) {
      throw new Error(`No mock response for query: ${queryName}`);
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }

  // Other methods we might need to mock
  async mutation() {
    return {};
  }

  async action() {
    return {};
  }

  close() {
    // Mock cleanup
  }
}

describe('protocol-evolution-e2e', () => {
  let mockClient: any;

  beforeEach(async () => {
    mockClient = new MockConvexClient('https://test.convex.cloud') as any;
    await resetProtocolStorage();
    resetInitializationState(); // Reset lazy initialization state
  });

  afterEach(async () => {
    await resetProtocolStorage();
    resetInitializationState(); // Reset lazy initialization state
    mockClient.close();
  });

  describe('initConvexReplicate', () => {
    it('should initialize successfully with matching versions', async () => {
      // Setup: Server and client both on version 1
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, { protocolVersion: 1 });
      await storeProtocolVersion(1);

      // Test: Initialization should succeed
      await expect(
        initConvexReplicate({
          convexClient: mockClient,
          api: { getProtocolVersion: mockFunctionRef },
        })
      ).resolves.not.toThrow();

      // Verify: Version should still be 1
      const localVersion = await getStoredProtocolVersion();
      expect(localVersion).toBe(1);
    });

    it('should migrate when server version is newer', async () => {
      // Setup: Client on v1, server on v2
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, { protocolVersion: 2 });
      await storeProtocolVersion(1);

      // Test: Initialization should succeed and run migration
      await expect(
        initConvexReplicate({
          convexClient: mockClient,
          api: { getProtocolVersion: mockFunctionRef },
        })
      ).resolves.not.toThrow();

      // Verify: Local version should be updated to server version
      const localVersion = await getStoredProtocolVersion();
      expect(localVersion).toBe(2);
    });

    it('should handle multiple version upgrades', async () => {
      // Setup: Client on v1, server on v3
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, { protocolVersion: 3 });
      await storeProtocolVersion(1);

      // Test: Should migrate through v1 → v2 → v3
      await expect(
        initConvexReplicate({
          convexClient: mockClient,
          api: { getProtocolVersion: mockFunctionRef },
        })
      ).resolves.not.toThrow();

      // Verify: Local version should be updated to server version
      const localVersion = await getStoredProtocolVersion();
      expect(localVersion).toBe(3);
    });

    it('should handle legacy client (no stored version)', async () => {
      // Setup: No local version (legacy client), server on v2
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, { protocolVersion: 2 });
      // Don't store any version - simulates legacy client

      // Test: Should initialize and migrate from v1 (default) to v2
      await expect(
        initConvexReplicate({
          convexClient: mockClient,
          api: { getProtocolVersion: mockFunctionRef },
        })
      ).resolves.not.toThrow();

      // Verify: Local version should be updated to server version
      const localVersion = await getStoredProtocolVersion();
      expect(localVersion).toBe(2);
    });

    it('should handle server version older than local version', async () => {
      // Setup: Client on v3, server on v2 (rollback scenario)
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, { protocolVersion: 2 });
      await storeProtocolVersion(3);

      // Test: Should still initialize (but warn)
      await expect(
        initConvexReplicate({
          convexClient: mockClient,
          api: { getProtocolVersion: mockFunctionRef },
        })
      ).resolves.not.toThrow();

      // Verify: Local version should be updated to server version
      const localVersion = await getStoredProtocolVersion();
      expect(localVersion).toBe(2);
    });

    it('should handle custom API endpoints', async () => {
      // Setup: Mock custom FunctionReference endpoint
      const customFunctionRef = 'custom:getProtocolVersion' as any;
      mockClient.setMockResponse(customFunctionRef, { protocolVersion: 5 });

      // Test: Should use custom API
      await expect(
        initConvexReplicate({
          convexClient: mockClient,
          api: {
            getProtocolVersion: customFunctionRef,
          },
        })
      ).resolves.not.toThrow();

      // Verify: Local version should be updated
      const localVersion = await getStoredProtocolVersion();
      expect(localVersion).toBe(5);
    });

    it('should throw error when no API is provided', async () => {
      // Test: Should throw error when no API provided
      await expect(initConvexReplicate({ convexClient: mockClient })).rejects.toThrow(
        'No protocol version endpoint provided'
      );
    });

    it('should throw error when server is unreachable', async () => {
      // Setup: Mock server error
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, new Error('Server unavailable'));

      // Test: Should throw error
      await expect(
        initConvexReplicate({
          convexClient: mockClient,
          api: { getProtocolVersion: mockFunctionRef },
        })
      ).rejects.toThrow('Server unavailable');
    });
  });

  describe('getProtocolInfo', () => {
    it('should return correct protocol information', async () => {
      // Setup: Server v2, client v1
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, { protocolVersion: 2 });
      await storeProtocolVersion(1);

      // Test: Get protocol info
      const info = await getProtocolInfo(mockClient, { getProtocolVersion: mockFunctionRef });

      // Verify: Should return correct information
      expect(info).toEqual({
        serverVersion: 2,
        localVersion: 1,
        needsMigration: true,
      });
    });

    it('should detect when no migration is needed', async () => {
      // Setup: Server and client both on v3
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, { protocolVersion: 3 });
      await storeProtocolVersion(3);

      // Test: Get protocol info
      const info = await getProtocolInfo(mockClient, { getProtocolVersion: mockFunctionRef });

      // Verify: Should indicate no migration needed
      expect(info).toEqual({
        serverVersion: 3,
        localVersion: 3,
        needsMigration: false,
      });
    });
  });

  describe('resetProtocolStorage', () => {
    it('should clear all protocol storage', async () => {
      // Setup: Store some protocol data
      await storeProtocolVersion(10);
      expect(await getStoredProtocolVersion()).toBe(10);

      // Test: Reset storage
      await resetProtocolStorage();

      // Verify: Should be back to default
      expect(await getStoredProtocolVersion()).toBe(1);
    });
  });

  describe('ensureInitialized (auto-initialization)', () => {
    it('should initialize once and cache result', async () => {
      // Setup: Mock server response
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, { protocolVersion: 1 });

      // Test: Call ensureInitialized multiple times
      await ensureInitialized({
        convexClient: mockClient,
        api: { getProtocolVersion: mockFunctionRef },
      });
      await ensureInitialized({
        convexClient: mockClient,
        api: { getProtocolVersion: mockFunctionRef },
      });
      await ensureInitialized({
        convexClient: mockClient,
        api: { getProtocolVersion: mockFunctionRef },
      });

      // Verify: Should only initialize once (checking version is stored)
      const localVersion = await getStoredProtocolVersion();
      expect(localVersion).toBe(1);
    });

    it('should return same promise when called concurrently', async () => {
      // Setup: Mock server response
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, { protocolVersion: 2 });

      // Test: Call ensureInitialized concurrently (simulates multiple collections)
      const promises = [
        ensureInitialized({
          convexClient: mockClient,
          api: { getProtocolVersion: mockFunctionRef },
        }),
        ensureInitialized({
          convexClient: mockClient,
          api: { getProtocolVersion: mockFunctionRef },
        }),
        ensureInitialized({
          convexClient: mockClient,
          api: { getProtocolVersion: mockFunctionRef },
        }),
      ];

      // Verify: All should resolve successfully
      await expect(Promise.all(promises)).resolves.toBeDefined();

      // Verify: Version should be stored
      const localVersion = await getStoredProtocolVersion();
      expect(localVersion).toBe(2);
    });

    it('should allow retry after failure', async () => {
      // Setup: First call fails, second succeeds
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, new Error('Network error'));

      // Test: First call should fail
      await expect(
        ensureInitialized({
          convexClient: mockClient,
          api: { getProtocolVersion: mockFunctionRef },
        })
      ).rejects.toThrow();

      // Setup: Fix the error for retry
      mockClient.setMockResponse(mockFunctionRef, { protocolVersion: 1 });

      // Test: Second call should succeed (retry allowed)
      await expect(
        ensureInitialized({
          convexClient: mockClient,
          api: { getProtocolVersion: mockFunctionRef },
        })
      ).resolves.not.toThrow();

      // Verify: Version should be stored
      const localVersion = await getStoredProtocolVersion();
      expect(localVersion).toBe(1);
    });

    it('should run migrations automatically on first call', async () => {
      // Setup: Client on v1, server on v3
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, { protocolVersion: 3 });
      await storeProtocolVersion(1);

      // Test: ensureInitialized should run migration
      await ensureInitialized({
        convexClient: mockClient,
        api: { getProtocolVersion: mockFunctionRef },
      });

      // Verify: Local version should be updated
      const localVersion = await getStoredProtocolVersion();
      expect(localVersion).toBe(3);
    });

    it('should provide helpful error message on failure', async () => {
      // Setup: Mock server unavailable
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, new Error('Component not installed'));

      // Test: Should throw with helpful message
      await expect(
        ensureInitialized({
          convexClient: mockClient,
          api: { getProtocolVersion: mockFunctionRef },
        })
      ).rejects.toThrow(/ConvexReplicate auto-initialization failed/);
      await expect(
        ensureInitialized({
          convexClient: mockClient,
          api: { getProtocolVersion: mockFunctionRef },
        })
      ).rejects.toThrow(/replicate component is not installed/);
    });
  });

  describe('resetInitializationState', () => {
    it('should reset initialization state for testing', async () => {
      // Setup: Initialize once
      const mockFunctionRef = 'test:getProtocolVersion' as any;
      mockClient.setMockResponse(mockFunctionRef, { protocolVersion: 1 });
      await ensureInitialized({
        convexClient: mockClient,
        api: { getProtocolVersion: mockFunctionRef },
      });

      // Test: Reset state
      resetInitializationState();

      // Verify: Should re-initialize on next call
      mockClient.setMockResponse(mockFunctionRef, { protocolVersion: 2 });
      await ensureInitialized({
        convexClient: mockClient,
        api: { getProtocolVersion: mockFunctionRef },
      });

      // Version should be updated (proving re-initialization happened)
      const localVersion = await getStoredProtocolVersion();
      expect(localVersion).toBe(2);
    });
  });
});
