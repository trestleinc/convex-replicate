/**
 * Real Convex Integration Tests (Browser Mode)
 *
 * These tests run in a real browser environment (Playwright headless)
 * against an actual Convex backend. They test the complete client stack:
 * - TanStack DB collection with reactive state
 * - Yjs CRDT encoding and conflict resolution
 * - IndexedDB persistence via y-indexeddb
 * - Real-time sync via Convex subscriptions
 *
 * Setup:
 * 1. cd src/test && npx convex dev (starts Convex dev server)
 * 2. pnpm run test:browser (runs browser tests with Playwright)
 *
 * These tests use Vitest browser mode which provides real browser APIs
 * (IndexedDB, WebSocket, etc.) needed by the replicate client.
 *
 * IMPORTANT: Tests use stable IDs and clean up before each test to ensure
 * proper CRDT merge testing (not creating new documents each time).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { commands } from 'vitest/browser';
import type { ConvexClient } from 'convex/browser';
import {
  createTestClient,
  createTestCollectionWithName,
  waitForReady,
  waitForItem,
  waitForRemoval,
  cleanup,
  type Task,
} from '../utils/test-collection';

// Augment vitest/browser module with our custom commands for multi-client testing
declare module 'vitest/browser' {
  interface BrowserCommands {
    createClient: (convexUrl: string, collectionName: string) => Promise<{ id: string }>;
    waitForItem: (clientId: string, itemId: string, timeoutMs?: number) => Promise<Task>;
    getItems: (clientId: string) => Promise<Task[]>;
    getItemCount: (clientId: string) => Promise<number>;
    insertItem: (clientId: string, item: Task) => Promise<void>;
    updateItem: (clientId: string, itemId: string, updates: Partial<Task>) => Promise<void>;
    deleteItem: (clientId: string, itemId: string) => Promise<void>;
    closeClient: (clientId: string) => Promise<void>;
    closeAllClients: () => Promise<void>;
  }
}

// Check if we're in real browser environment (not jsdom)
// jsdom has window but doesn't have real IndexedDB or WebSocket
const isRealBrowser =
  typeof window !== 'undefined' &&
  typeof window.indexedDB !== 'undefined' &&
  !('_isMockFunction' in (window.indexedDB?.open || {}));

// Skip if not in real browser mode (integration tests need Playwright)
const describeIntegration = isRealBrowser ? describe : describe.skip;

describeIntegration('Real Convex Integration (Browser Mode)', () => {
  let client: ConvexClient;

  beforeAll(() => {
    client = createTestClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  describe('Collection CRUD Operations', () => {
    it('inserts a task via collection.insert() with CRDT encoding', async () => {
      const collection = createTestCollectionWithName(client, 'tasks');
      const taskId = crypto.randomUUID();

      // Wait for collection to be ready
      await waitForReady(collection);

      // Insert via Collection API (handles CRDT encoding automatically)
      const tx = collection.insert({
        id: taskId,
        text: 'Test task from browser integration',
        isCompleted: false,
      });

      // Wait for persistence (mutation sent to Convex)
      await tx.isPersisted.promise;

      // Verify in local state
      const task = await waitForItem(collection, (t) => t.id === taskId);
      expect(task.text).toBe('Test task from browser integration');
      expect(task.isCompleted).toBe(false);
    });

    it('updates a task via collection.update() with delta encoding (verifies merge)', async () => {
      const collection = createTestCollectionWithName(client, 'tasks');
      const taskId = crypto.randomUUID();

      await waitForReady(collection);

      // Insert first
      const insertTx = collection.insert({
        id: taskId,
        text: 'Original text',
        isCompleted: false,
      });
      await insertTx.isPersisted.promise;

      // Wait for item to appear and count documents
      await waitForItem(collection, (t) => t.id === taskId);
      const countAfterInsert = collection.state.size;

      // Update via Collection API (generates Yjs delta) - uses callback pattern
      const updateTx = collection.update(taskId, (draft) => {
        draft.text = 'Updated text';
        draft.isCompleted = true;
      });
      await updateTx.isPersisted.promise;

      // Verify update
      const task = await waitForItem(
        collection,
        (t) => t.id === taskId && t.text === 'Updated text'
      );
      expect(task.text).toBe('Updated text');
      expect(task.isCompleted).toBe(true);

      // CRITICAL: Verify document count stayed the same (update, not new insert)
      const countAfterUpdate = collection.state.size;
      expect(countAfterUpdate).toBe(countAfterInsert);
    });

    it('deletes a task via collection.delete()', async () => {
      const collection = createTestCollectionWithName(client, 'tasks');
      const taskId = crypto.randomUUID();

      await waitForReady(collection);

      // Insert first
      const insertTx = collection.insert({
        id: taskId,
        text: 'To be deleted',
        isCompleted: false,
      });
      await insertTx.isPersisted.promise;

      // Verify inserted
      await waitForItem(collection, (t) => t.id === taskId);

      // Delete via Collection API
      const deleteTx = collection.delete(taskId);
      await deleteTx.isPersisted.promise;

      // Verify removed
      await waitForRemoval(collection, taskId);

      const items = Array.from(collection.state.values()) as Task[];
      const found = items.find((t) => t.id === taskId);
      expect(found).toBeUndefined();
    });
  });

  // Multi-client sync tests are covered by scale.test.ts which uses
  // waitForConvergence (count-based) instead of waitForItem (id-based lookup).
  // Scale tests prove sync works with 10/25/50 concurrent clients.

  describe('Offline Persistence', () => {
    it('persists data to IndexedDB for offline access', async () => {
      const taskId = crypto.randomUUID();

      // First session - create task
      {
        const collection = createTestCollectionWithName(client, 'tasks');
        await waitForReady(collection);

        const tx = collection.insert({
          id: taskId,
          text: 'Persisted task',
          isCompleted: false,
        });
        await tx.isPersisted.promise;

        // Verify in local state
        await waitForItem(collection, (t) => t.id === taskId);
      }

      // Small delay for IndexedDB write
      await new Promise((r) => setTimeout(r, 500));

      // Second session - same collection name should restore from IndexedDB
      {
        const collection = createTestCollectionWithName(client, 'tasks');
        await waitForReady(collection, 15000);

        // Data should be restored from IndexedDB (via y-indexeddb)
        const task = await waitForItem(collection, (t) => t.id === taskId, 10000);
        expect(task.text).toBe('Persisted task');
      }
    });
  });
});
