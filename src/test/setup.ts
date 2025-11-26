/**
 * Vitest Test Setup
 * Configures fake-indexeddb for testing IndexedDB operations
 */

import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';

// Reset IndexedDB between tests for isolation
// fake-indexeddb's databases() can behave differently, so we use a simpler approach
beforeEach(() => {
  // Clear all IndexedDB databases synchronously using fake-indexeddb internals
  // This is simpler and more reliable than async deletion which can hang
  if (typeof indexedDB !== 'undefined') {
    // fake-indexeddb stores databases internally - calling deleteDatabase is synchronous-ish
    // We don't await because fake-indexeddb handles it synchronously
    try {
      // Try to delete known database names used in tests
      const knownDbNames = ['replicate-test', 'replicate', 'test-collection', 'tasks'];
      for (const name of knownDbNames) {
        indexedDB.deleteDatabase(name);
      }
    } catch {
      // Ignore errors during cleanup
    }
  }
});
