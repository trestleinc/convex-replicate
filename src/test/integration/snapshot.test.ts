/**
 * Snapshot Integration Tests (Browser Mode)
 *
 * Tests the snapshot serving and recovery features:
 * - getInitialState() returns merged snapshot for SSR
 * - Disparity detection when client is too far behind
 * - New clients bootstrap efficiently from snapshot
 * - Snapshot + delta replay for catch-up sync
 *
 * IMPORTANT: The server stores all data in the "posts" collection (configured in
 * defineReplicate). The client-side collection name is only for client isolation.
 * When compacting, we must use "posts" as the collection name.
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

describeIntegration('Snapshots (Browser Mode)', () => {
  let client: ConvexClient;
  let testRunId: string;

  beforeAll(() => {
    client = createTestClient();
    // Unique prefix for this test run to avoid conflicts with previous runs
    testRunId = `snap-${Date.now()}`;
  });

  afterAll(async () => {
    await client?.close();
  });

  describe('Initial State from Deltas', () => {
    it('serves initial state by merging deltas when no snapshot exists', async () => {
      const clientCollectionName = `${testRunId}-delta`;

      // Client 1 creates some posts
      const collection1 = createPostsCollection(client, clientCollectionName);
      await waitForReady(collection1 as ConvexCollection<Post>);

      const postIds = [`${testRunId}-post-a`, `${testRunId}-post-b`, `${testRunId}-post-c`];
      for (const id of postIds) {
        const tx = collection1.insert({
          id,
          authorId: 'author-1',
          title: `Title for ${id}`,
          content: `Content for ${id}`,
          status: 'published',
          tags: ['test'],
          viewCount: 100,
          likeCount: 10,
        });
        await tx.isPersisted.promise;
      }

      // Wait for sync
      await new Promise((r) => setTimeout(r, 500));

      // Client 2 connects and should receive initial state from deltas
      const client2 = createTestClient();
      const collection2 = createPostsCollection(client2, clientCollectionName);

      await waitForReady(collection2 as ConvexCollection<Post>);

      // Verify all posts are available
      for (const id of postIds) {
        const post = await waitForPost(
          collection2 as ConvexCollection<Post>,
          (p) => p.id === id,
          10000
        );
        expect(post.title).toBe(`Title for ${id}`);
      }

      await cleanup(client2);
    });
  });

  describe('Initial State from Snapshot', () => {
    it('serves initial state from snapshot after compaction', async () => {
      const clientCollectionName = `${testRunId}-compact`;
      const collection = createPostsCollection(client, clientCollectionName);

      await waitForReady(collection as ConvexCollection<Post>);

      // Create 105 posts to trigger compaction
      const postCount = 105;
      const testPosts: string[] = [];

      for (let i = 0; i < postCount; i++) {
        const postId = `${testRunId}-snap-${i}`;
        testPosts.push(postId);

        const tx = collection.insert({
          id: postId,
          authorId: `author-${i % 3}`,
          title: `Snapshot Test ${i}`,
          content: `Content for snapshot test ${i}`,
          status: 'published',
          tags: ['snapshot-test'],
          viewCount: i * 5,
          likeCount: i,
        });
        await tx.isPersisted.promise;
      }

      await new Promise((r) => setTimeout(r, 1000));

      // Compact to create snapshot (use SERVER_COLLECTION)
      const compactResult = await compactCollection(client, SERVER_COLLECTION, 0);
      // Allow both success and skip (if already compacted)
      expect(compactResult.success === true || compactResult.skipped === true).toBe(true);

      console.log('Compaction completed:', compactResult);

      // New client should get initial state from snapshot (faster than replaying 105 deltas)
      const client2 = createTestClient();
      const collection2 = createPostsCollection(client2, clientCollectionName);

      const startTime = Date.now();
      await waitForReady(collection2 as ConvexCollection<Post>);
      const loadTime = Date.now() - startTime;

      console.log(`Initial state loaded in ${loadTime}ms`);

      // Verify a sample of posts are available
      const samplesToCheck = [0, 50, 100];
      for (const idx of samplesToCheck) {
        const postId = testPosts[idx];
        const post = await waitForPost(
          collection2 as ConvexCollection<Post>,
          (p) => p.id === postId,
          15000
        );
        expect(post.title).toBe(`Snapshot Test ${idx}`);
      }

      await cleanup(client2);
    }, 180000);
  });

  describe('Snapshot + Delta Catch-up', () => {
    it('syncs new changes after loading from snapshot', async () => {
      const clientCollectionName = `${testRunId}-catchup`;
      const collection = createPostsCollection(client, clientCollectionName);

      await waitForReady(collection as ConvexCollection<Post>);

      // Create 105 posts and compact
      for (let i = 0; i < 105; i++) {
        const tx = collection.insert({
          id: `${testRunId}-initial-${i}`,
          authorId: 'author-1',
          title: `Initial Post ${i}`,
          content: 'Initial content',
          status: 'draft',
          tags: [],
          viewCount: 0,
          likeCount: 0,
        });
        await tx.isPersisted.promise;
      }

      await new Promise((r) => setTimeout(r, 1000));
      await compactCollection(client, SERVER_COLLECTION, 0);

      // Add some new posts AFTER compaction
      const newPostIds = [
        `${testRunId}-new-post-1`,
        `${testRunId}-new-post-2`,
        `${testRunId}-new-post-3`,
      ];
      for (const id of newPostIds) {
        const tx = collection.insert({
          id,
          authorId: 'author-1',
          title: `New Post: ${id}`,
          content: 'New content after compaction',
          status: 'published',
          tags: ['new'],
          viewCount: 0,
          likeCount: 0,
        });
        await tx.isPersisted.promise;
      }

      await new Promise((r) => setTimeout(r, 500));

      // New client loads snapshot + catches up with new deltas
      const client2 = createTestClient();
      const collection2 = createPostsCollection(client2, clientCollectionName);

      await waitForReady(collection2 as ConvexCollection<Post>);

      // Verify both old (from snapshot) and new (from deltas) posts exist
      const oldPost = await waitForPost(
        collection2 as ConvexCollection<Post>,
        (p) => p.id === `${testRunId}-initial-50`,
        15000
      );
      expect(oldPost.title).toBe('Initial Post 50');

      for (const id of newPostIds) {
        const newPost = await waitForPost(
          collection2 as ConvexCollection<Post>,
          (p) => p.id === id,
          15000
        );
        expect(newPost.title).toBe(`New Post: ${id}`);
      }

      await cleanup(client2);
    }, 180000);
  });

  describe('Multi-Client Sync with Snapshots', () => {
    it('maintains consistency between clients after compaction', async () => {
      const clientCollectionName = `${testRunId}-multi`;

      const client1 = createTestClient();
      const client2 = createTestClient();

      const collection1 = createPostsCollection(client1, clientCollectionName);
      const collection2 = createPostsCollection(client2, clientCollectionName);

      await Promise.all([
        waitForReady(collection1 as ConvexCollection<Post>),
        waitForReady(collection2 as ConvexCollection<Post>),
      ]);

      // Client 1 creates posts
      for (let i = 0; i < 105; i++) {
        const tx = collection1.insert({
          id: `${testRunId}-multi-${i}`,
          authorId: 'client-1',
          title: `Multi-client Post ${i}`,
          content: 'Content',
          status: 'published',
          tags: [],
          viewCount: 0,
          likeCount: 0,
        });
        await tx.isPersisted.promise;
      }

      await new Promise((r) => setTimeout(r, 1000));

      // Client 2 should see all posts
      const postFromClient2 = await waitForPost(
        collection2 as ConvexCollection<Post>,
        (p) => p.id === `${testRunId}-multi-100`,
        15000
      );
      expect(postFromClient2.title).toBe('Multi-client Post 100');

      // Compact (use SERVER_COLLECTION)
      await compactCollection(client1, SERVER_COLLECTION, 0);

      // Client 2 updates a post (after compaction)
      const updateTx = collection2.update(`${testRunId}-multi-50`, (draft) => {
        draft.title = 'Updated by Client 2';
        draft.status = 'archived';
      });
      await updateTx.isPersisted.promise;

      // Client 1 should see the update
      const updatedPost = await waitForPost(
        collection1 as ConvexCollection<Post>,
        (p) => p.id === `${testRunId}-multi-50` && p.title === 'Updated by Client 2',
        15000
      );
      expect(updatedPost.status).toBe('archived');

      await cleanup(client1);
      await cleanup(client2);
    }, 180000);
  });
});
