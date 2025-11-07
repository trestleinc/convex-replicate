/**
 * Test utilities and mocks for ConvexReplicate testing
 */

import { vi, expect } from 'vitest';

/**
 * Mock ConvexClient for testing
 * Provides a simple way to mock Convex client behavior
 */
export class MockConvexClient {
  private responses: Map<string, any> = new Map();
  private mutations: Map<string, any> = new Map();
  private actions: Map<string, any> = new Map();

  constructor(public url: string) {}

  // Set mock responses for queries
  setMockResponse(query: string, response: any) {
    this.responses.set(query, response);
  }

  // Set mock responses for mutations
  setMockMutation(mutation: string, response: any) {
    this.mutations.set(mutation, response);
  }

  // Set mock responses for actions
  setMockAction(action: string, response: any) {
    this.actions.set(action, response);
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

  async mutation(mutationName: string): Promise<any> {
    const response = this.mutations.get(mutationName);
    if (!response) {
      throw new Error(`No mock response for mutation: ${mutationName}`);
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }

  async action(actionName: string): Promise<any> {
    const response = this.actions.get(actionName);
    if (!response) {
      throw new Error(`No mock response for action: ${actionName}`);
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }

  close() {
    // Mock cleanup
  }

  // Clear all mocks
  clearMocks() {
    this.responses.clear();
    this.mutations.clear();
    this.actions.clear();
  }
}

/**
 * Create a mock ConvexClient with default protocol version response
 */
export function createMockConvexClient(protocolVersion: number = 1): any {
  const client = new MockConvexClient('https://test.convex.cloud');
  client.setMockResponse('replicate:getProtocolVersion', { protocolVersion });
  return client as any;
}

/**
 * Mock Yjs document for testing
 */
export class MockYDoc {
  private data: Map<string, any> = new Map();

  getMap(): any {
    return {
      get: (key: string) => this.data.get(key),
      set: (key: string, value: any) => this.data.set(key, value),
      delete: (key: string) => this.data.delete(key),
      has: (key: string) => this.data.has(key),
    };
  }

  // Mock Yjs encoding/decoding
  static encodeStateAsUpdate(): ArrayBuffer {
    return new ArrayBuffer(0);
  }

  static applyUpdate(): void {
    // Mock implementation
  }
}

/**
 * Wait for async operations to complete
 * Useful for testing race conditions and async behavior
 */
export async function waitForAsync(ms: number = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock logger for testing
 */
export function createMockLogger(): {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * Helper to create test data for collections
 */
export function createTestDocument<T>(overrides: Partial<T> = {}): T {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    ...overrides,
  } as T;
}

/**
 * Helper to create multiple test documents
 */
export function createTestDocuments<T>(
  count: number,
  baseOverrides: Partial<T> = {},
  indexOverrides: Partial<T>[] = []
): T[] {
  return Array.from({ length: count }, (_, i) =>
    createTestDocument({
      ...baseOverrides,
      ...indexOverrides[i],
    })
  );
}

/**
 * Mock IndexedDB operations for testing
 */
export function mockIndexedDB() {
  const store = new Map<string, any>();

  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key))),
    set: vi.fn((key: string, value: any) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    del: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      store.clear();
      return Promise.resolve();
    }),
    entries: vi.fn(() => Promise.resolve(Array.from(store.entries()))),
    // Helper for testing
    _getStore: () => store,
  };
}

/**
 * Create a mock TanStack DB collection
 */
export function createMockCollection<T>(initialData: T[] = []) {
  let data = [...initialData];

  return {
    insert: vi.fn((doc: T) => {
      data.push(doc);
      return Promise.resolve(doc);
    }),
    update: vi.fn((id: string, updater: (doc: T) => void) => {
      const index = data.findIndex((doc: any) => doc.id === id);
      if (index !== -1) {
        updater(data[index]);
      }
      return Promise.resolve();
    }),
    delete: vi.fn((id: string) => {
      data = data.filter((doc: any) => doc.id !== id);
      return Promise.resolve();
    }),
    findMany: vi.fn(() => Promise.resolve(data)),
    findOne: vi.fn((id: string) => Promise.resolve(data.find((doc: any) => doc.id === id))),
    // Helper for testing
    _getData: () => data,
    _setData: (newData: T[]) => {
      data = newData;
    },
  };
}

/**
 * Test helper to verify protocol migration behavior
 */
export async function testProtocolMigration(
  fromVersion: number,
  toVersion: number,
  expectedBehavior: 'migrate' | 'no-migrate' | 'downgrade'
) {
  const { getStoredProtocolVersion, storeProtocolVersion } = await import('../client/protocol.js');

  // Setup initial version
  await storeProtocolVersion(fromVersion);

  // Run migration
  const { migrateLocalStorage } = await import('../client/protocol.js');
  await migrateLocalStorage(fromVersion, toVersion);

  // Verify behavior
  const currentVersion = await getStoredProtocolVersion();

  switch (expectedBehavior) {
    case 'migrate':
      // Migration should run, but version stays the same (init function updates it)
      expect(currentVersion).toBe(fromVersion);
      break;
    case 'no-migrate':
      // No migration should run
      expect(currentVersion).toBe(fromVersion);
      break;
    case 'downgrade':
      // Downgrade scenario
      expect(currentVersion).toBe(fromVersion);
      break;
  }
}
