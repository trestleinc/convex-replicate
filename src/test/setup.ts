/**
 * Test setup for Vitest
 *
 * Sets up fake-indexeddb for IndexedDB testing
 * and provides global test utilities.
 */

import 'fake-indexeddb/auto';

// Mock console methods in tests to avoid Biome warnings
global.console = {
  ...console,
  // Uncomment to suppress console.log in tests
  // log: vi.fn(),
  // debug: vi.fn(),
  // info: vi.fn(),
  // warn: vi.fn(),
  // error: vi.fn(),
};

// Mock Web Crypto API for tests that need it
if (!global.crypto) {
  global.crypto = {
    randomUUID: () => `test-uuid-${Math.random().toString(36).substring(2, 11)}`,
    getRandomValues: (array: Uint8Array) => {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    },
  } as any;
}

// Add custom matchers if needed
// expect.extend({
//   // Custom matchers here
// });
