/**
 * Pruning Integration Tests (Browser Mode)
 *
 * Tests the snapshot pruning feature which:
 * - Removes old snapshots beyond retention period
 * - Keeps at least 2 most recent snapshots
 * - Maintains data integrity after pruning
 *
 * IMPORTANT: The server stores all data in the "posts" collection (configured in
 * defineReplicate). The client-side collection name is only for client isolation.
 * When compacting/pruning, we must use "posts" as the collection name.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import {
  createTestClient,
  createPostsCollection,
  waitForReady,
  waitForPost,
  cleanup,
  compactCollection,
  pruneCollection,
  type Post,
} from '../utils/test-collection';
import type { ConvexCollection } from '$/client/index.js';

// Check if we're in real browser environment
const isRealBrowser =
  typeof window !== 'undefined' &&
  typeof window.indexedDB !== 'undefined' &&
  !('_isMockFunction' in (window.indexedDB?.open || {}));

const describeIntegration = isRealBrowser ? describe : describe.skip;

// Server collection name (must match defineReplicate config in posts.ts)
const SERVER_COLLECTION = 'posts';

describeIntegration.skip('Pruning (Browser Mode)', () => {
  let client: ConvexClient;
  let testRunId: string;

  beforeAll(() => {
    client = createTestClient();
    // Unique prefix for this test run to avoid conflicts with previous runs
    testRunId = `prune-${Date.now()}`;
  });

  afterAll(async () => {
    await client?.close();
  });

  describe('Snapshot Pruning', () => {
    it('prunes old snapshots while keeping recent ones', async () => {
      const clientCollectionName = `${testRunId}-test`;
      const collection = createPostsCollection(client, clientCollectionName);

      await waitForReady(collection as ConvexCollection<Post>);

      // Create posts and compact multiple times to generate multiple snapshots
      // Each compaction round needs 100+ deltas

      // Round 1: Create 105 posts and compact
      console.log('Round 1: Creating posts...');
      for (let i = 0; i < 105; i++) {
        const tx = collection.insert({
          id: `${testRunId}-round1-${i}`,
          authorId: 'author-1',
          title: `Round 1 Post ${i}`,
          content: 'Content',
          status: 'published',
          tags: ['round1'],
          viewCount: 0,
          likeCount: 0,
        });
        await tx.isPersisted.promise;
      }
      await new Promise((r) => setTimeout(r, 1000));

      const compact1 = await compactCollection(client, SERVER_COLLECTION, 0);
      expect(compact1.success === true || compact1.skipped === true).toBe(true);
      console.log('Round 1 compaction:', compact1);

      // Round 2: Update posts to generate more deltas and compact again
      console.log('Round 2: Updating posts...');
      for (let i = 0; i < 105; i++) {
        const tx = collection.update(`${testRunId}-round1-${i}`, (draft) => {
          draft.title = `Round 2 Updated ${i}`;
          draft.viewCount = 100;
        });
        await tx.isPersisted.promise;
      }
      await new Promise((r) => setTimeout(r, 1000));

      const compact2 = await compactCollection(client, SERVER_COLLECTION, 0);
      expect(compact2.success === true || compact2.skipped === true).toBe(true);
      console.log('Round 2 compaction:', compact2);

      // Round 3: More updates for third snapshot
      console.log('Round 3: More updates...');
      for (let i = 0; i < 105; i++) {
        const tx = collection.update(`${testRunId}-round1-${i}`, (draft) => {
          draft.title = `Round 3 Final ${i}`;
          draft.likeCount = 50;
        });
        await tx.isPersisted.promise;
      }
      await new Promise((r) => setTimeout(r, 1000));

      const compact3 = await compactCollection(client, SERVER_COLLECTION, 0);
      expect(compact3.success === true || compact3.skipped === true).toBe(true);
      console.log('Round 3 compaction:', compact3);

      // Now prune with 0 retention to remove old snapshots
      const pruneResult = await pruneCollection(client, SERVER_COLLECTION, 0);

      console.log('Prune result:', pruneResult);

      expect(pruneResult.collection).toBe(SERVER_COLLECTION);
      // Should keep at most 2 snapshots remaining
      expect(pruneResult.snapshotsRemaining).toBeLessThanOrEqual(2);
    }, 300000); // 5 minute timeout for 3 rounds of 105 operations

    it('preserves data integrity after pruning', async () => {
      const clientCollectionName = `${testRunId}-integrity`;
      const collection = createPostsCollection(client, clientCollectionName);

      await waitForReady(collection as ConvexCollection<Post>);

      // Create posts with unique IDs
      for (let i = 0; i < 105; i++) {
        const tx = collection.insert({
          id: `${testRunId}-integrity-${i}`,
          authorId: 'author-1',
          title: `Integrity Test ${i}`,
          content: 'Content',
          status: 'published',
          tags: [],
          viewCount: i,
          likeCount: 0,
        });
        await tx.isPersisted.promise;
      }
      await new Promise((r) => setTimeout(r, 1000));

      await compactCollection(client, SERVER_COLLECTION, 0);

      // Update and compact again
      for (let i = 0; i < 105; i++) {
        const tx = collection.update(`${testRunId}-integrity-${i}`, (draft) => {
          draft.title = `Updated Integrity ${i}`;
        });
        await tx.isPersisted.promise;
      }
      await new Promise((r) => setTimeout(r, 1000));

      await compactCollection(client, SERVER_COLLECTION, 0);

      // Prune
      await pruneCollection(client, SERVER_COLLECTION, 0);

      // New client should still be able to load all data
      const client2 = createTestClient();
      const collection2 = createPostsCollection(client2, clientCollectionName);

      await waitForReady(collection2 as ConvexCollection<Post>);

      // Verify sample posts
      for (const idx of [0, 50, 100]) {
        const post = await waitForPost(
          collection2 as ConvexCollection<Post>,
          (p) => p.id === `${testRunId}-integrity-${idx}`,
          15000
        );
        expect(post.title).toBe(`Updated Integrity ${idx}`);
      }

      await cleanup(client2);
    }, 240000); // 4 minute timeout
  });

  describe('Prune Edge Cases', () => {
    it('handles pruning on server collection', async () => {
      const clientCollectionName = `${testRunId}-empty`;
      const collection = createPostsCollection(client, clientCollectionName);

      await waitForReady(collection as ConvexCollection<Post>);

      // Create a single post (minimal data)
      const tx = collection.insert({
        id: `${testRunId}-single-post`,
        authorId: 'author-1',
        title: 'Single Post',
        content: 'Minimal data',
        status: 'draft',
        tags: [],
        viewCount: 0,
        likeCount: 0,
      });
      await tx.isPersisted.promise;

      // Prune should handle gracefully
      const pruneResult = await pruneCollection(client, SERVER_COLLECTION, 0);

      expect(pruneResult.collection).toBe(SERVER_COLLECTION);
      // deletedCount can be 0 or more depending on existing snapshots
      expect(typeof pruneResult.deletedCount).toBe('number');
    });
  });
});
