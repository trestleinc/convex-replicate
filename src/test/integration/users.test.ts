/**
 * Users Integration Tests (Browser Mode)
 *
 * Tests the Users entity with complex nested objects (preferences):
 * - CRUD operations with nested objects
 * - Multi-client real-time sync
 * - CRDT conflict resolution on nested fields
 *
 * IMPORTANT: Tests use stable IDs to properly test CRDT merge functionality.
 * The server stores all data in the "users" collection (configured in
 * defineReplicate). The client-side collection name is only for client isolation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import {
  createTestClient,
  createUsersCollection,
  waitForUser,
  cleanup,
  type User,
} from '../utils/test-collection';
import type { ConvexCollection } from '$/client/index.js';

// Check if we're in real browser environment
const isRealBrowser =
  typeof window !== 'undefined' &&
  typeof window.indexedDB !== 'undefined' &&
  !('_isMockFunction' in (window.indexedDB?.open || {}));

const describeIntegration = isRealBrowser ? describe : describe.skip;

// Stable collection name for all user tests
const TEST_COLLECTION = 'integration-test-users';

describeIntegration.skip('Users (Browser Mode)', () => {
  let client: ConvexClient;

  beforeAll(() => {
    client = createTestClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  // Helper to wait for collection ready with correct typing
  async function waitForReady(
    collection: ConvexCollection<User>,
    timeoutMs = 10000
  ): Promise<void> {
    await Promise.race([
      collection.stateWhenReady(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Collection not ready after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  describe('User CRUD Operations', () => {
    it('inserts a user with basic fields', async () => {
      const collection = createUsersCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const userId = 'test-basic-user';
      const tx = collection.insert({
        id: userId,
        email: 'basic@example.com',
        displayName: 'Basic User',
        isOnline: false,
      });
      await tx.isPersisted.promise;

      const user = await waitForUser(collection, (u) => u.id === userId);
      expect(user.email).toBe('basic@example.com');
      expect(user.displayName).toBe('Basic User');
      expect(user.isOnline).toBe(false);
    });

    it('inserts a user with nested preferences', async () => {
      const collection = createUsersCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const userId = 'test-prefs-user';
      const tx = collection.insert({
        id: userId,
        email: 'prefs@example.com',
        displayName: 'User With Preferences',
        isOnline: true,
        preferences: {
          theme: 'dark',
          notifications: true,
          language: 'en',
        },
      });
      await tx.isPersisted.promise;

      const user = await waitForUser(collection, (u) => u.id === userId);
      expect(user.preferences?.theme).toBe('dark');
      expect(user.preferences?.notifications).toBe(true);
      expect(user.preferences?.language).toBe('en');
    });

    it('updates basic user fields (verifies merge)', async () => {
      const collection = createUsersCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const userId = 'test-update-basic-user';

      // Insert first
      const insertTx = collection.insert({
        id: userId,
        email: 'original@example.com',
        displayName: 'Original Name',
        isOnline: false,
      });
      await insertTx.isPersisted.promise;

      // Wait for item to appear in local state
      await waitForUser(collection, (u) => u.id === userId);
      const countAfterInsert = collection.state.size;

      // Update
      const updateTx = collection.update(userId, (draft) => {
        draft.displayName = 'Updated Name';
        draft.isOnline = true;
      });
      await updateTx.isPersisted.promise;

      // Verify
      const user = await waitForUser(
        collection,
        (u) => u.id === userId && u.displayName === 'Updated Name'
      );
      expect(user.displayName).toBe('Updated Name');
      expect(user.isOnline).toBe(true);

      // CRITICAL: Verify document count stayed the same (update, not new insert)
      const countAfterUpdate = collection.state.size;
      expect(countAfterUpdate).toBe(countAfterInsert);
    });

    it('updates nested user preferences (verifies merge)', async () => {
      const collection = createUsersCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const userId = 'test-update-prefs-user';

      // Insert with initial preferences
      const insertTx = collection.insert({
        id: userId,
        email: 'nested@example.com',
        displayName: 'Nested Update User',
        isOnline: true,
        preferences: {
          theme: 'light',
          notifications: false,
          language: 'en',
        },
      });
      await insertTx.isPersisted.promise;

      await waitForUser(collection, (u) => u.id === userId);
      const countAfterInsert = collection.state.size;

      // Update nested preferences
      const updateTx = collection.update(userId, (draft) => {
        if (draft.preferences) {
          draft.preferences.theme = 'dark';
          draft.preferences.notifications = true;
        }
      });
      await updateTx.isPersisted.promise;

      // Verify nested update
      const user = await waitForUser(
        collection,
        (u) => u.id === userId && u.preferences?.theme === 'dark'
      );
      expect(user.preferences?.theme).toBe('dark');
      expect(user.preferences?.notifications).toBe(true);
      expect(user.preferences?.language).toBe('en'); // unchanged

      // CRITICAL: Verify document count stayed the same (merge, not new doc)
      const countAfterUpdate = collection.state.size;
      expect(countAfterUpdate).toBe(countAfterInsert);
    });

    it('handles optional fields (avatarUrl, bio)', async () => {
      const collection = createUsersCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const userId = 'test-optional-user';

      // Insert without optional fields
      const insertTx = collection.insert({
        id: userId,
        email: 'optional@example.com',
        displayName: 'Optional Fields User',
        isOnline: false,
      });
      await insertTx.isPersisted.promise;

      await waitForUser(collection, (u) => u.id === userId);

      // Add optional fields
      const updateTx = collection.update(userId, (draft) => {
        draft.avatarUrl = 'https://example.com/avatar.png';
        draft.bio = 'Hello, I am a test user!';
      });
      await updateTx.isPersisted.promise;

      // Verify
      const user = await waitForUser(collection, (u) => u.id === userId && u.bio !== undefined);
      expect(user.avatarUrl).toBe('https://example.com/avatar.png');
      expect(user.bio).toBe('Hello, I am a test user!');
    });

    it('deletes a user', async () => {
      const collection = createUsersCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const userId = 'test-delete-user';

      // Insert first
      const insertTx = collection.insert({
        id: userId,
        email: 'delete@example.com',
        displayName: 'To Be Deleted',
        isOnline: false,
      });
      await insertTx.isPersisted.promise;

      await waitForUser(collection, (u) => u.id === userId);

      // Delete
      const deleteTx = collection.delete(userId);
      await deleteTx.isPersisted.promise;

      // Wait and verify removal
      await new Promise((r) => setTimeout(r, 1000));
      const items = Array.from(collection.state.values()) as User[];
      const found = items.find((u) => u.id === userId);
      expect(found).toBeUndefined();
    });
  });

  describe('Multi-Client User Sync', () => {
    it('syncs user profile changes between clients', async () => {
      const client1 = createTestClient();
      const client2 = createTestClient();

      try {
        const collection1 = createUsersCollection(client1, TEST_COLLECTION);
        const collection2 = createUsersCollection(client2, TEST_COLLECTION);

        await Promise.all([waitForReady(collection1), waitForReady(collection2)]);

        const userId = 'test-sync-user';

        // Client 1 creates user
        const tx = collection1.insert({
          id: userId,
          email: 'sync@example.com',
          displayName: 'Sync User',
          isOnline: true,
          preferences: {
            theme: 'light',
            notifications: true,
            language: 'en',
          },
        });
        await tx.isPersisted.promise;

        // Client 2 should receive via subscription
        const user = await waitForUser(collection2, (u) => u.id === userId, 15000);
        expect(user.email).toBe('sync@example.com');
        expect(user.preferences?.theme).toBe('light');
      } finally {
        await cleanup(client1);
        await cleanup(client2);
      }
    });

    it('syncs user updates between clients (verifies CRDT merge)', async () => {
      const client1 = createTestClient();
      const client2 = createTestClient();

      try {
        const collection1 = createUsersCollection(client1, TEST_COLLECTION);
        const collection2 = createUsersCollection(client2, TEST_COLLECTION);

        await Promise.all([waitForReady(collection1), waitForReady(collection2)]);

        const userId = 'test-sync-update-user';

        // Client 1 creates user
        const insertTx = collection1.insert({
          id: userId,
          email: 'sync-update@example.com',
          displayName: 'Original',
          isOnline: false,
        });
        await insertTx.isPersisted.promise;

        // Wait for both clients to have the user
        await waitForUser(collection1, (u) => u.id === userId);
        await waitForUser(collection2, (u) => u.id === userId);

        // Count documents on client 2 before update
        const countBeforeUpdate = collection2.state.size;

        // Client 1 updates
        const updateTx = collection1.update(userId, (draft) => {
          draft.displayName = 'Updated by Client 1';
          draft.isOnline = true;
        });
        await updateTx.isPersisted.promise;

        // Client 2 should see the update
        const updated = await waitForUser(
          collection2,
          (u) => u.id === userId && u.displayName === 'Updated by Client 1',
          15000
        );
        expect(updated.isOnline).toBe(true);

        // CRITICAL: Verify document count stayed the same (merge, not new doc)
        const countAfterUpdate = collection2.state.size;
        expect(countAfterUpdate).toBe(countBeforeUpdate);
      } finally {
        await cleanup(client1);
        await cleanup(client2);
      }
    });

    it('resolves concurrent preference updates (CRDT)', async () => {
      const client1 = createTestClient();
      const client2 = createTestClient();

      try {
        const collection1 = createUsersCollection(client1, TEST_COLLECTION);
        const collection2 = createUsersCollection(client2, TEST_COLLECTION);

        await Promise.all([waitForReady(collection1), waitForReady(collection2)]);

        const userId = 'test-crdt-user';

        // Client 1 creates user
        const createTx = collection1.insert({
          id: userId,
          email: 'crdt@example.com',
          displayName: 'CRDT User',
          isOnline: true,
          preferences: {
            theme: 'light',
            notifications: false,
            language: 'en',
          },
        });
        await createTx.isPersisted.promise;

        // Wait for both clients to have the user
        await waitForUser(collection1, (u) => u.id === userId, 15000);
        await waitForUser(collection2, (u) => u.id === userId, 15000);

        // Both clients update simultaneously - client 1 changes theme, client 2 changes notifications
        const update1 = collection1.update(userId, (draft) => {
          if (draft.preferences) {
            draft.preferences.theme = 'dark';
          }
        });
        const update2 = collection2.update(userId, (draft) => {
          if (draft.preferences) {
            draft.preferences.notifications = true;
          }
        });

        await Promise.all([update1.isPersisted.promise, update2.isPersisted.promise]);

        // Wait for sync to settle
        await new Promise((r) => setTimeout(r, 2000));

        // Both clients should converge to the same value
        const items1 = Array.from(collection1.state.values()) as User[];
        const items2 = Array.from(collection2.state.values()) as User[];

        const user1 = items1.find((u) => u.id === userId);
        const user2 = items2.find((u) => u.id === userId);

        // Both should have same preferences (converged via CRDT)
        expect(user1?.preferences?.theme).toBe(user2?.preferences?.theme);
        expect(user1?.preferences?.notifications).toBe(user2?.preferences?.notifications);

        // CRITICAL: Should only have 1 document with this ID (merged, not duplicated)
        const matchingDocs1 = items1.filter((u) => u.id === userId);
        const matchingDocs2 = items2.filter((u) => u.id === userId);
        expect(matchingDocs1.length).toBe(1);
        expect(matchingDocs2.length).toBe(1);
      } finally {
        await cleanup(client1);
        await cleanup(client2);
      }
    });
  });
});
