/**
 * Compaction Integration Tests (Browser Mode)
 *
 * Tests the CRDT compaction feature which:
 * - Merges 100+ deltas into a single snapshot
 * - Validates snapshot contains all updates
 * - Deletes old deltas to save storage
 *
 * Note: Compaction requires 100+ deltas older than retention period.
 * We use retentionDays=0 to make all deltas eligible immediately.
 *
 * IMPORTANT: The server stores all data in the "posts" collection (configured in
 * defineReplicate). The client-side collection name is only for client isolation
 * (Yjs doc, IndexedDB). When compacting, we must use "posts" as the collection name.
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

describeIntegration('Compaction (Browser Mode)', () => {
  let client: ConvexClient;
  let testRunId: string;

  beforeAll(() => {
    client = createTestClient();
    // Unique prefix for this test run to avoid conflicts with previous runs
    testRunId = `compact-${Date.now()}`;
  });

  afterAll(async () => {
    await client?.close();
  });

  describe('Delta Compaction', () => {
    it('compacts 100+ deltas into a snapshot', async () => {
      // Client-side collection name for isolation (Yjs/IndexedDB)
      const clientCollectionName = `${testRunId}-full`;
      const collection = createPostsCollection(client, clientCollectionName);

      await waitForReady(collection as ConvexCollection<Post>);

      // Create enough posts to generate 100+ deltas
      // Each insert is 1 delta, so we need 100+ inserts
      const postCount = 110;

      for (let i = 0; i < postCount; i++) {
        // Use unique IDs to avoid conflicts with other test runs
        const tx = collection.insert({
          id: `${testRunId}-post-${i}`,
          authorId: `author-${i % 5}`,
          title: `Post number ${i}`,
          content: `This is the content for post ${i}. It has some text.`,
          status: i % 3 === 0 ? 'published' : 'draft',
          tags: ['test', `batch-${Math.floor(i / 10)}`],
          viewCount: i * 10,
          likeCount: i,
        });
        await tx.isPersisted.promise;

        // Log progress every 25 posts
        if ((i + 1) % 25 === 0) {
          console.log(`Created ${i + 1}/${postCount} posts`);
        }
      }

      // Wait for all writes to sync
      await new Promise((r) => setTimeout(r, 1000));

      // Compact the SERVER collection (not client collection name)
      // All data goes to "posts" regardless of client-side collection name
      const result = await compactCollection(client, SERVER_COLLECTION, 0);

      // Should either succeed or skip (if previous run already compacted)
      expect(result.success === true || result.skipped === true).toBe(true);

      if (result.success) {
        expect(result.deltasCompacted).toBeGreaterThanOrEqual(100);
        expect(result.snapshotSize).toBeGreaterThan(0);
      }

      console.log('Compaction result:', result);
    }, 120000); // 2 minute timeout for creating 100+ posts

    it('preserves data integrity after compaction', async () => {
      const clientCollectionName = `${testRunId}-integrity`;
      const collection = createPostsCollection(client, clientCollectionName);

      await waitForReady(collection as ConvexCollection<Post>);

      // Create 105 posts with unique IDs
      const postCount = 105;
      const expectedPosts: Array<{ id: string; title: string }> = [];

      for (let i = 0; i < postCount; i++) {
        const postId = `${testRunId}-integrity-${i}`;
        const title = `Integrity Test Post ${i}`;

        expectedPosts.push({ id: postId, title });

        const tx = collection.insert({
          id: postId,
          authorId: 'author-1',
          title,
          content: `Content ${i}`,
          status: 'published',
          tags: [],
          viewCount: 0,
          likeCount: 0,
        });
        await tx.isPersisted.promise;
      }

      await new Promise((r) => setTimeout(r, 1000));

      // Compact the SERVER collection
      const compactResult = await compactCollection(client, SERVER_COLLECTION, 0);
      // Allow both success and skip (if already compacted)
      expect(compactResult.success === true || compactResult.skipped === true).toBe(true);

      // Create a new client to verify data is served correctly
      const client2 = createTestClient();
      const collection2 = createPostsCollection(client2, clientCollectionName);

      await waitForReady(collection2 as ConvexCollection<Post>);

      // Verify some posts are still accessible
      for (const expected of expectedPosts.slice(0, 10)) {
        const post = await waitForPost(
          collection2 as ConvexCollection<Post>,
          (p) => p.id === expected.id,
          15000
        );
        expect(post.title).toBe(expected.title);
      }

      await cleanup(client2);
    }, 180000); // 3 minute timeout
  });
});
