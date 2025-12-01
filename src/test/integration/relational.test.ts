/**
 * Relational Data Integration Tests (Browser Mode)
 *
 * Tests cross-entity relationships:
 * - Users → Posts (authorId foreign key)
 * - Posts → Comments (postId foreign key)
 * - Users → Comments (authorId foreign key)
 * - Threaded comments (parentId self-reference)
 *
 * IMPORTANT: Tests use stable IDs to properly test CRDT merge functionality.
 * These tests verify that referential relationships work correctly
 * across multiple collections with real-time sync.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import {
  createTestClient,
  createUsersCollection,
  createPostsCollection,
  createCommentsCollection,
  waitForUser,
  waitForPost,
  waitForComment,
  cleanup,
  type User,
  type Post,
  type Comment,
} from '../utils/test-collection';
import type { ConvexCollection } from '$/client/index.js';

// Check if we're in real browser environment
const isRealBrowser =
  typeof window !== 'undefined' &&
  typeof window.indexedDB !== 'undefined' &&
  !('_isMockFunction' in (window.indexedDB?.open || {}));

const describeIntegration = isRealBrowser ? describe : describe.skip;

// Stable collection names for all relational tests
const USERS_COLLECTION = 'integration-test-rel-users';
const POSTS_COLLECTION = 'integration-test-rel-posts';
const COMMENTS_COLLECTION = 'integration-test-rel-comments';

describeIntegration.skip('Relational Data (Browser Mode)', () => {
  let client: ConvexClient;

  beforeAll(() => {
    client = createTestClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  // Helper functions
  async function waitForReadyUser(
    collection: ConvexCollection<User>,
    timeoutMs = 10000
  ): Promise<void> {
    await Promise.race([
      collection.stateWhenReady(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`User collection not ready after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }

  async function waitForReadyPost(
    collection: ConvexCollection<Post>,
    timeoutMs = 10000
  ): Promise<void> {
    await Promise.race([
      collection.stateWhenReady(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Post collection not ready after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }

  async function waitForReadyComment(
    collection: ConvexCollection<Comment>,
    timeoutMs = 10000
  ): Promise<void> {
    await Promise.race([
      collection.stateWhenReady(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Comment collection not ready after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }

  describe('User → Post Relationships', () => {
    it('creates a user and their posts', async () => {
      const usersCol = createUsersCollection(client, USERS_COLLECTION);
      const postsCol = createPostsCollection(client, POSTS_COLLECTION);

      await Promise.all([waitForReadyUser(usersCol), waitForReadyPost(postsCol)]);

      const userId = 'test-author';

      // Create user first
      const userTx = usersCol.insert({
        id: userId,
        email: 'author@example.com',
        displayName: 'Author User',
        isOnline: true,
      });
      await userTx.isPersisted.promise;

      await waitForUser(usersCol, (u) => u.id === userId);

      // Create posts referencing the user
      const post1Tx = postsCol.insert({
        id: 'test-rel-post-1',
        authorId: userId,
        title: 'First Post',
        content: 'Content of first post',
        status: 'published',
        tags: ['test'],
        viewCount: 0,
        likeCount: 0,
      });
      await post1Tx.isPersisted.promise;

      const post2Tx = postsCol.insert({
        id: 'test-rel-post-2',
        authorId: userId,
        title: 'Second Post',
        content: 'Content of second post',
        status: 'draft',
        tags: ['test'],
        viewCount: 0,
        likeCount: 0,
      });
      await post2Tx.isPersisted.promise;

      // Wait for posts
      await waitForPost(postsCol, (p) => p.id === 'test-rel-post-1');
      await waitForPost(postsCol, (p) => p.id === 'test-rel-post-2');

      // Query posts by author
      const posts = Array.from(postsCol.state.values()) as Post[];
      const authorPosts = posts.filter((p) => p.authorId === userId);
      expect(authorPosts.length).toBe(2);
    });

    it('updates author profile without affecting post references (verifies merge)', async () => {
      const usersCol = createUsersCollection(client, USERS_COLLECTION);
      const postsCol = createPostsCollection(client, POSTS_COLLECTION);

      await Promise.all([waitForReadyUser(usersCol), waitForReadyPost(postsCol)]);

      const userId = 'test-update-author';

      // Create user
      const userTx = usersCol.insert({
        id: userId,
        email: 'updatable@example.com',
        displayName: 'Original Name',
        isOnline: true,
      });
      await userTx.isPersisted.promise;

      await waitForUser(usersCol, (u) => u.id === userId);
      const countAfterUserInsert = usersCol.state.size;

      // Create post
      const postTx = postsCol.insert({
        id: 'test-ref-post',
        authorId: userId,
        title: 'Referenced Post',
        content: 'This post references a user',
        status: 'published',
        tags: [],
        viewCount: 0,
        likeCount: 0,
      });
      await postTx.isPersisted.promise;

      await waitForPost(postsCol, (p) => p.id === 'test-ref-post');

      // Update user profile
      const updateTx = usersCol.update(userId, (draft) => {
        draft.displayName = 'Updated Name';
        draft.bio = 'Now has a bio';
      });
      await updateTx.isPersisted.promise;

      // Verify user updated
      const updatedUser = await waitForUser(
        usersCol,
        (u) => u.id === userId && u.displayName === 'Updated Name'
      );
      expect(updatedUser.bio).toBe('Now has a bio');

      // CRITICAL: Verify user count stayed the same (merge, not new doc)
      const countAfterUpdate = usersCol.state.size;
      expect(countAfterUpdate).toBe(countAfterUserInsert);

      // Verify post still references the user correctly
      const posts = Array.from(postsCol.state.values()) as Post[];
      const post = posts.find((p) => p.id === 'test-ref-post');
      expect(post?.authorId).toBe(userId);
    });
  });

  describe('Post → Comment Relationships', () => {
    it('creates comments on a post', async () => {
      const postsCol = createPostsCollection(client, POSTS_COLLECTION);
      const commentsCol = createCommentsCollection(client, COMMENTS_COLLECTION);

      await Promise.all([waitForReadyPost(postsCol), waitForReadyComment(commentsCol)]);

      const postId = 'test-commented-post';

      // Create post
      const postTx = postsCol.insert({
        id: postId,
        authorId: 'user-1',
        title: 'Post with Comments',
        content: 'This post has comments',
        status: 'published',
        tags: [],
        viewCount: 0,
        likeCount: 0,
      });
      await postTx.isPersisted.promise;

      await waitForPost(postsCol, (p) => p.id === postId);

      // Create comments on the post
      const comment1Tx = commentsCol.insert({
        id: 'test-rel-comment-1',
        postId: postId,
        authorId: 'user-2',
        content: 'First comment',
        isEdited: false,
      });
      await comment1Tx.isPersisted.promise;

      const comment2Tx = commentsCol.insert({
        id: 'test-rel-comment-2',
        postId: postId,
        authorId: 'user-3',
        content: 'Second comment',
        isEdited: false,
      });
      await comment2Tx.isPersisted.promise;

      // Wait for comments
      await waitForComment(commentsCol, (c) => c.id === 'test-rel-comment-1');
      await waitForComment(commentsCol, (c) => c.id === 'test-rel-comment-2');

      // Query comments by post
      const comments = Array.from(commentsCol.state.values()) as Comment[];
      const postComments = comments.filter((c) => c.postId === postId);
      expect(postComments.length).toBe(2);
    });

    it('updates post without affecting comment references (verifies merge)', async () => {
      const postsCol = createPostsCollection(client, POSTS_COLLECTION);
      const commentsCol = createCommentsCollection(client, COMMENTS_COLLECTION);

      await Promise.all([waitForReadyPost(postsCol), waitForReadyComment(commentsCol)]);

      const postId = 'test-updatable-post';

      // Create post
      const postTx = postsCol.insert({
        id: postId,
        authorId: 'user-1',
        title: 'Original Title',
        content: 'Original content',
        status: 'draft',
        tags: [],
        viewCount: 0,
        likeCount: 0,
      });
      await postTx.isPersisted.promise;

      await waitForPost(postsCol, (p) => p.id === postId);
      const countAfterPostInsert = postsCol.state.size;

      // Create comment
      const commentTx = commentsCol.insert({
        id: 'test-post-ref-comment',
        postId: postId,
        authorId: 'user-2',
        content: 'Comment on the post',
        isEdited: false,
      });
      await commentTx.isPersisted.promise;

      await waitForComment(commentsCol, (c) => c.id === 'test-post-ref-comment');

      // Update post
      const updateTx = postsCol.update(postId, (draft) => {
        draft.title = 'Updated Title';
        draft.status = 'published';
      });
      await updateTx.isPersisted.promise;

      // Verify post updated
      await waitForPost(postsCol, (p) => p.id === postId && p.title === 'Updated Title');

      // CRITICAL: Verify post count stayed the same (merge, not new doc)
      const countAfterUpdate = postsCol.state.size;
      expect(countAfterUpdate).toBe(countAfterPostInsert);

      // Comment should still reference the post
      const comments = Array.from(commentsCol.state.values()) as Comment[];
      const comment = comments.find((c) => c.id === 'test-post-ref-comment');
      expect(comment?.postId).toBe(postId);
    });
  });

  describe('User → Comment Relationships', () => {
    it('creates comments by different users', async () => {
      const usersCol = createUsersCollection(client, USERS_COLLECTION);
      const commentsCol = createCommentsCollection(client, COMMENTS_COLLECTION);

      await Promise.all([waitForReadyUser(usersCol), waitForReadyComment(commentsCol)]);

      const user1Id = 'test-commenter-1';
      const user2Id = 'test-commenter-2';

      // Create users
      const user1Tx = usersCol.insert({
        id: user1Id,
        email: 'user1@example.com',
        displayName: 'User One',
        isOnline: true,
      });
      await user1Tx.isPersisted.promise;

      const user2Tx = usersCol.insert({
        id: user2Id,
        email: 'user2@example.com',
        displayName: 'User Two',
        isOnline: false,
      });
      await user2Tx.isPersisted.promise;

      await waitForUser(usersCol, (u) => u.id === user1Id);
      await waitForUser(usersCol, (u) => u.id === user2Id);

      // Create comments by each user
      const c1Tx = commentsCol.insert({
        id: 'test-user1-comment',
        postId: 'some-post',
        authorId: user1Id,
        content: 'Comment by user 1',
        isEdited: false,
      });
      await c1Tx.isPersisted.promise;

      const c2Tx = commentsCol.insert({
        id: 'test-user2-comment',
        postId: 'some-post',
        authorId: user2Id,
        content: 'Comment by user 2',
        isEdited: false,
      });
      await c2Tx.isPersisted.promise;

      // Wait for comments
      await waitForComment(commentsCol, (c) => c.id === 'test-user1-comment');
      await waitForComment(commentsCol, (c) => c.id === 'test-user2-comment');

      // Query comments by author
      const comments = Array.from(commentsCol.state.values()) as Comment[];
      const user1Comments = comments.filter((c) => c.authorId === user1Id);
      const user2Comments = comments.filter((c) => c.authorId === user2Id);

      expect(user1Comments.length).toBe(1);
      expect(user2Comments.length).toBe(1);
    });
  });

  describe('Cross-Entity Multi-Client Sync', () => {
    it('syncs user, posts, and comments across clients', async () => {
      const client1 = createTestClient();
      const client2 = createTestClient();

      try {
        // Client 1 collections
        const users1 = createUsersCollection(client1, USERS_COLLECTION);
        const posts1 = createPostsCollection(client1, POSTS_COLLECTION);
        const comments1 = createCommentsCollection(client1, COMMENTS_COLLECTION);

        // Client 2 collections
        const users2 = createUsersCollection(client2, USERS_COLLECTION);
        const posts2 = createPostsCollection(client2, POSTS_COLLECTION);
        const comments2 = createCommentsCollection(client2, COMMENTS_COLLECTION);

        await Promise.all([
          waitForReadyUser(users1),
          waitForReadyPost(posts1),
          waitForReadyComment(comments1),
          waitForReadyUser(users2),
          waitForReadyPost(posts2),
          waitForReadyComment(comments2),
        ]);

        const userId = 'test-multi-user';
        const postId = 'test-multi-post';
        const commentId = 'test-multi-comment';

        // Client 1 creates user
        const userTx = users1.insert({
          id: userId,
          email: 'multi@example.com',
          displayName: 'Multi User',
          isOnline: true,
        });
        await userTx.isPersisted.promise;

        // Client 1 creates post
        const postTx = posts1.insert({
          id: postId,
          authorId: userId,
          title: 'Multi-client Post',
          content: 'Created from client 1',
          status: 'published',
          tags: [],
          viewCount: 0,
          likeCount: 0,
        });
        await postTx.isPersisted.promise;

        // Wait for client 2 to see user and post
        await waitForUser(users2, (u) => u.id === userId, 15000);
        await waitForPost(posts2, (p) => p.id === postId, 15000);

        // Client 2 adds comment
        const commentTx = comments2.insert({
          id: commentId,
          postId: postId,
          authorId: userId,
          content: 'Comment from client 2',
          isEdited: false,
        });
        await commentTx.isPersisted.promise;

        // Client 1 should see the comment
        const comment = await waitForComment(comments1, (c) => c.id === commentId, 15000);
        expect(comment.postId).toBe(postId);
        expect(comment.authorId).toBe(userId);
        expect(comment.content).toBe('Comment from client 2');
      } finally {
        await cleanup(client1);
        await cleanup(client2);
      }
    });

    it('handles concurrent edits across related entities (verifies CRDT merge)', async () => {
      const client1 = createTestClient();
      const client2 = createTestClient();

      try {
        const users1 = createUsersCollection(client1, USERS_COLLECTION);
        const posts1 = createPostsCollection(client1, POSTS_COLLECTION);
        const users2 = createUsersCollection(client2, USERS_COLLECTION);
        const posts2 = createPostsCollection(client2, POSTS_COLLECTION);

        await Promise.all([
          waitForReadyUser(users1),
          waitForReadyPost(posts1),
          waitForReadyUser(users2),
          waitForReadyPost(posts2),
        ]);

        const userId = 'test-concurrent-user';

        // Client 1 creates user
        const userTx = users1.insert({
          id: userId,
          email: 'concurrent@example.com',
          displayName: 'Concurrent User',
          isOnline: true,
        });
        await userTx.isPersisted.promise;

        // Wait for both clients to see user
        await waitForUser(users1, (u) => u.id === userId, 15000);
        await waitForUser(users2, (u) => u.id === userId, 15000);

        // Concurrent operations:
        // Client 1 updates user
        const userUpdate = users1.update(userId, (draft) => {
          draft.displayName = 'Updated by Client 1';
        });

        // Client 2 creates post (same authorId)
        const postTx = posts2.insert({
          id: 'test-concurrent-post',
          authorId: userId,
          title: 'Concurrent Post',
          content: 'Created while user was being updated',
          status: 'draft',
          tags: [],
          viewCount: 0,
          likeCount: 0,
        });

        await Promise.all([userUpdate.isPersisted.promise, postTx.isPersisted.promise]);

        // Wait for sync
        await new Promise((r) => setTimeout(r, 2000));

        // Both clients should converge
        // User should have updated name
        const usersItems1 = Array.from(users1.state.values()) as User[];
        const usersItems2 = Array.from(users2.state.values()) as User[];

        const user1 = usersItems1.find((u) => u.id === userId);
        const user2 = usersItems2.find((u) => u.id === userId);

        expect(user1?.displayName).toBe(user2?.displayName);

        // CRITICAL: Should only have 1 user with this ID (merged, not duplicated)
        const matchingUsers1 = usersItems1.filter((u) => u.id === userId);
        const matchingUsers2 = usersItems2.filter((u) => u.id === userId);
        expect(matchingUsers1.length).toBe(1);
        expect(matchingUsers2.length).toBe(1);

        // Post should exist on both clients with correct authorId
        const postsItems1 = Array.from(posts1.state.values()) as Post[];
        const postsItems2 = Array.from(posts2.state.values()) as Post[];

        const post1 = postsItems1.find((p) => p.id === 'test-concurrent-post');
        const post2 = postsItems2.find((p) => p.id === 'test-concurrent-post');

        expect(post1).toBeDefined();
        expect(post2).toBeDefined();
        expect(post1?.authorId).toBe(userId);
        expect(post2?.authorId).toBe(userId);
      } finally {
        await cleanup(client1);
        await cleanup(client2);
      }
    });
  });

  describe('Full Relational Graph', () => {
    it('creates a complete user-post-comment graph', async () => {
      const usersCol = createUsersCollection(client, USERS_COLLECTION);
      const postsCol = createPostsCollection(client, POSTS_COLLECTION);
      const commentsCol = createCommentsCollection(client, COMMENTS_COLLECTION);

      await Promise.all([
        waitForReadyUser(usersCol),
        waitForReadyPost(postsCol),
        waitForReadyComment(commentsCol),
      ]);

      // Create 2 users
      const author1Id = 'test-graph-author1';
      const author2Id = 'test-graph-author2';

      await usersCol.insert({
        id: author1Id,
        email: 'author1@example.com',
        displayName: 'Author One',
        isOnline: true,
      }).isPersisted.promise;

      await usersCol.insert({
        id: author2Id,
        email: 'author2@example.com',
        displayName: 'Author Two',
        isOnline: false,
      }).isPersisted.promise;

      await waitForUser(usersCol, (u) => u.id === author1Id);
      await waitForUser(usersCol, (u) => u.id === author2Id);

      // Author 1 creates 2 posts
      const post1Id = 'test-graph-post1';
      const post2Id = 'test-graph-post2';

      await postsCol.insert({
        id: post1Id,
        authorId: author1Id,
        title: 'Post by Author 1',
        content: 'First post content',
        status: 'published',
        tags: ['graph-test'],
        viewCount: 10,
        likeCount: 2,
      }).isPersisted.promise;

      await postsCol.insert({
        id: post2Id,
        authorId: author1Id,
        title: 'Second Post by Author 1',
        content: 'Second post content',
        status: 'published',
        tags: ['graph-test'],
        viewCount: 5,
        likeCount: 1,
      }).isPersisted.promise;

      await waitForPost(postsCol, (p) => p.id === post1Id);
      await waitForPost(postsCol, (p) => p.id === post2Id);

      // Author 2 comments on Author 1's posts
      await commentsCol.insert({
        id: 'test-graph-comment1',
        postId: post1Id,
        authorId: author2Id,
        content: 'Author 2 commenting on Post 1',
        isEdited: false,
      }).isPersisted.promise;

      // Author 1 replies to Author 2's comment
      await commentsCol.insert({
        id: 'test-graph-reply',
        postId: post1Id,
        authorId: author1Id,
        parentId: 'test-graph-comment1', // Threaded reply
        content: 'Author 1 replying to Author 2',
        isEdited: false,
      }).isPersisted.promise;

      // Author 2 comments on post 2
      await commentsCol.insert({
        id: 'test-graph-comment2',
        postId: post2Id,
        authorId: author2Id,
        content: 'Another comment by Author 2',
        isEdited: false,
      }).isPersisted.promise;

      await waitForComment(commentsCol, (c) => c.id === 'test-graph-comment1');
      await waitForComment(commentsCol, (c) => c.id === 'test-graph-reply');
      await waitForComment(commentsCol, (c) => c.id === 'test-graph-comment2');

      // Verify the complete graph
      const users = Array.from(usersCol.state.values()) as User[];
      const posts = Array.from(postsCol.state.values()) as Post[];
      const comments = Array.from(commentsCol.state.values()) as Comment[];

      // 2 users with graph prefix
      expect(users.filter((u) => u.id.startsWith('test-graph')).length).toBe(2);

      // 2 posts by author 1
      const author1Posts = posts.filter((p) => p.authorId === author1Id);
      expect(author1Posts.length).toBe(2);

      // 3 comments total (2 by author2, 1 by author1)
      const graphComments = comments.filter((c) => c.id.startsWith('test-graph'));
      expect(graphComments.length).toBe(3);

      // 2 comments on post 1 (1 root + 1 reply)
      const post1Comments = comments.filter((c) => c.postId === post1Id);
      expect(post1Comments.length).toBe(2);

      // Verify threading
      const reply = comments.find((c) => c.id === 'test-graph-reply');
      expect(reply?.parentId).toBe('test-graph-comment1');
    });
  });
});
