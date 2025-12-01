/**
 * Comments Integration Tests (Browser Mode)
 *
 * Tests the Comments entity with:
 * - CRUD operations with reactions
 * - Threaded comments (parentId)
 * - Multi-client real-time sync
 * - Concurrent reaction updates
 *
 * IMPORTANT: Tests use stable IDs to properly test CRDT merge functionality.
 * The server stores all data in the "comments" collection (configured in
 * defineReplicate). The client-side collection name is only for client isolation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import {
  createTestClient,
  createCommentsCollection,
  waitForComment,
  waitForCommentRemoval,
  cleanup,
  type Comment,
} from '../utils/test-collection';
import type { ConvexCollection } from '$/client/index.js';

// Check if we're in real browser environment
const isRealBrowser =
  typeof window !== 'undefined' &&
  typeof window.indexedDB !== 'undefined' &&
  !('_isMockFunction' in (window.indexedDB?.open || {}));

const describeIntegration = isRealBrowser ? describe : describe.skip;

// Stable collection name for all comment tests
const TEST_COLLECTION = 'integration-test-comments';

describeIntegration.skip('Comments (Browser Mode)', () => {
  let client: ConvexClient;

  beforeAll(() => {
    client = createTestClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  // Helper to wait for collection ready with correct typing
  async function waitForReady(
    collection: ConvexCollection<Comment>,
    timeoutMs = 10000
  ): Promise<void> {
    await Promise.race([
      collection.stateWhenReady(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Collection not ready after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  describe('Comment CRUD Operations', () => {
    it('inserts a comment with basic fields', async () => {
      const collection = createCommentsCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const commentId = 'test-basic-comment';
      const tx = collection.insert({
        id: commentId,
        postId: 'post-123',
        authorId: 'user-456',
        content: 'This is a test comment',
        isEdited: false,
      });
      await tx.isPersisted.promise;

      const comment = await waitForComment(collection, (c) => c.id === commentId);
      expect(comment.postId).toBe('post-123');
      expect(comment.authorId).toBe('user-456');
      expect(comment.content).toBe('This is a test comment');
      expect(comment.isEdited).toBe(false);
    });

    it('inserts a comment with reactions', async () => {
      const collection = createCommentsCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const commentId = 'test-reactions-comment';
      const tx = collection.insert({
        id: commentId,
        postId: 'post-123',
        authorId: 'user-456',
        content: 'Comment with reactions',
        isEdited: false,
        reactions: {
          likes: 5,
          hearts: 2,
          laughs: 1,
        },
      });
      await tx.isPersisted.promise;

      const comment = await waitForComment(collection, (c) => c.id === commentId);
      expect(comment.reactions?.likes).toBe(5);
      expect(comment.reactions?.hearts).toBe(2);
      expect(comment.reactions?.laughs).toBe(1);
    });

    it('updates comment content (verifies merge)', async () => {
      const collection = createCommentsCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const commentId = 'test-update-comment';

      // Insert first
      const insertTx = collection.insert({
        id: commentId,
        postId: 'post-123',
        authorId: 'user-456',
        content: 'Original content',
        isEdited: false,
      });
      await insertTx.isPersisted.promise;

      // Wait for item to appear in local state
      await waitForComment(collection, (c) => c.id === commentId);
      const countAfterInsert = collection.state.size;

      // Update
      const updateTx = collection.update(commentId, (draft) => {
        draft.content = 'Updated content';
        draft.isEdited = true;
        draft.editedAt = Date.now();
      });
      await updateTx.isPersisted.promise;

      // Verify
      const comment = await waitForComment(
        collection,
        (c) => c.id === commentId && c.content === 'Updated content'
      );
      expect(comment.content).toBe('Updated content');
      expect(comment.isEdited).toBe(true);
      expect(comment.editedAt).toBeDefined();

      // CRITICAL: Verify document count stayed the same (update, not new insert)
      const countAfterUpdate = collection.state.size;
      expect(countAfterUpdate).toBe(countAfterInsert);
    });

    it('updates comment reactions (verifies merge)', async () => {
      const collection = createCommentsCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const commentId = 'test-update-reactions-comment';

      // Insert with initial reactions
      const insertTx = collection.insert({
        id: commentId,
        postId: 'post-123',
        authorId: 'user-456',
        content: 'Comment to react to',
        isEdited: false,
        reactions: {
          likes: 0,
          hearts: 0,
          laughs: 0,
        },
      });
      await insertTx.isPersisted.promise;

      await waitForComment(collection, (c) => c.id === commentId);
      const countAfterInsert = collection.state.size;

      // Increment reactions
      const updateTx = collection.update(commentId, (draft) => {
        if (draft.reactions) {
          draft.reactions.likes = draft.reactions.likes + 1;
          draft.reactions.hearts = draft.reactions.hearts + 3;
        }
      });
      await updateTx.isPersisted.promise;

      // Verify
      const comment = await waitForComment(
        collection,
        (c) => c.id === commentId && (c.reactions?.likes ?? 0) > 0
      );
      expect(comment.reactions?.likes).toBe(1);
      expect(comment.reactions?.hearts).toBe(3);
      expect(comment.reactions?.laughs).toBe(0);

      // CRITICAL: Verify document count stayed the same (merge, not new doc)
      const countAfterUpdate = collection.state.size;
      expect(countAfterUpdate).toBe(countAfterInsert);
    });

    it('marks comment as edited', async () => {
      const collection = createCommentsCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const commentId = 'test-edited-comment';

      // Insert
      const insertTx = collection.insert({
        id: commentId,
        postId: 'post-123',
        authorId: 'user-456',
        content: 'Will be edited',
        isEdited: false,
      });
      await insertTx.isPersisted.promise;

      await waitForComment(collection, (c) => c.id === commentId);

      // Edit
      const editTime = Date.now();
      const updateTx = collection.update(commentId, (draft) => {
        draft.content = 'This has been edited';
        draft.isEdited = true;
        draft.editedAt = editTime;
      });
      await updateTx.isPersisted.promise;

      // Verify edit metadata
      const comment = await waitForComment(collection, (c) => c.id === commentId && c.isEdited);
      expect(comment.isEdited).toBe(true);
      expect(comment.editedAt).toBeDefined();
    });

    it('deletes a comment', async () => {
      const collection = createCommentsCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const commentId = 'test-delete-comment';

      // Insert first
      const insertTx = collection.insert({
        id: commentId,
        postId: 'post-123',
        authorId: 'user-456',
        content: 'To be deleted',
        isEdited: false,
      });
      await insertTx.isPersisted.promise;

      await waitForComment(collection, (c) => c.id === commentId);

      // Delete
      const deleteTx = collection.delete(commentId);
      await deleteTx.isPersisted.promise;

      // Verify removal
      await waitForCommentRemoval(collection, commentId);
      const items = Array.from(collection.state.values()) as Comment[];
      const found = items.find((c) => c.id === commentId);
      expect(found).toBeUndefined();
    });
  });

  describe('Threaded Comments (parentId)', () => {
    it('creates a reply to a comment', async () => {
      const collection = createCommentsCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const parentId = 'test-parent-comment';
      const replyId = 'test-reply-comment';

      // Create parent comment
      const parentTx = collection.insert({
        id: parentId,
        postId: 'post-123',
        authorId: 'user-1',
        content: 'This is the parent comment',
        isEdited: false,
      });
      await parentTx.isPersisted.promise;

      await waitForComment(collection, (c) => c.id === parentId);

      // Create reply
      const replyTx = collection.insert({
        id: replyId,
        postId: 'post-123',
        authorId: 'user-2',
        parentId: parentId, // Reference to parent
        content: 'This is a reply',
        isEdited: false,
      });
      await replyTx.isPersisted.promise;

      // Verify
      const reply = await waitForComment(collection, (c) => c.id === replyId);
      expect(reply.parentId).toBe(parentId);
      expect(reply.content).toBe('This is a reply');
    });

    it('creates nested replies (multi-level threading)', async () => {
      const collection = createCommentsCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const level1Id = 'test-level1';
      const level2Id = 'test-level2';
      const level3Id = 'test-level3';

      // Level 1 (root comment)
      const tx1 = collection.insert({
        id: level1Id,
        postId: 'post-123',
        authorId: 'user-1',
        content: 'Level 1 comment',
        isEdited: false,
      });
      await tx1.isPersisted.promise;
      await waitForComment(collection, (c) => c.id === level1Id);

      // Level 2 (reply to level 1)
      const tx2 = collection.insert({
        id: level2Id,
        postId: 'post-123',
        authorId: 'user-2',
        parentId: level1Id,
        content: 'Level 2 reply',
        isEdited: false,
      });
      await tx2.isPersisted.promise;
      await waitForComment(collection, (c) => c.id === level2Id);

      // Level 3 (reply to level 2)
      const tx3 = collection.insert({
        id: level3Id,
        postId: 'post-123',
        authorId: 'user-3',
        parentId: level2Id,
        content: 'Level 3 reply',
        isEdited: false,
      });
      await tx3.isPersisted.promise;

      // Verify hierarchy
      const level3 = await waitForComment(collection, (c) => c.id === level3Id);
      expect(level3.parentId).toBe(level2Id);

      const items = Array.from(collection.state.values()) as Comment[];
      const level2 = items.find((c) => c.id === level2Id);
      expect(level2?.parentId).toBe(level1Id);

      const level1 = items.find((c) => c.id === level1Id);
      expect(level1?.parentId).toBeUndefined();
    });

    it('deleting parent does not affect child comments', async () => {
      const collection = createCommentsCollection(client, TEST_COLLECTION);

      await waitForReady(collection);

      const parentId = 'test-del-parent';
      const childId = 'test-del-child';

      // Create parent
      const parentTx = collection.insert({
        id: parentId,
        postId: 'post-123',
        authorId: 'user-1',
        content: 'Parent to be deleted',
        isEdited: false,
      });
      await parentTx.isPersisted.promise;
      await waitForComment(collection, (c) => c.id === parentId);

      // Create child
      const childTx = collection.insert({
        id: childId,
        postId: 'post-123',
        authorId: 'user-2',
        parentId: parentId,
        content: 'Child comment',
        isEdited: false,
      });
      await childTx.isPersisted.promise;
      await waitForComment(collection, (c) => c.id === childId);

      // Delete parent
      const deleteTx = collection.delete(parentId);
      await deleteTx.isPersisted.promise;

      await waitForCommentRemoval(collection, parentId);

      // Child should still exist
      const items = Array.from(collection.state.values()) as Comment[];
      const child = items.find((c) => c.id === childId);
      expect(child).toBeDefined();
      expect(child?.parentId).toBe(parentId); // Still references deleted parent
    });
  });

  describe('Multi-Client Comment Sync', () => {
    it('syncs new comments between clients', async () => {
      const client1 = createTestClient();
      const client2 = createTestClient();

      try {
        const collection1 = createCommentsCollection(client1, TEST_COLLECTION);
        const collection2 = createCommentsCollection(client2, TEST_COLLECTION);

        await Promise.all([waitForReady(collection1), waitForReady(collection2)]);

        const commentId = 'test-sync-comment';

        // Client 1 creates comment
        const tx = collection1.insert({
          id: commentId,
          postId: 'post-123',
          authorId: 'user-from-client1',
          content: 'Comment from client 1',
          isEdited: false,
        });
        await tx.isPersisted.promise;

        // Client 2 should receive via subscription
        const comment = await waitForComment(collection2, (c) => c.id === commentId, 15000);
        expect(comment.authorId).toBe('user-from-client1');
        expect(comment.content).toBe('Comment from client 1');
      } finally {
        await cleanup(client1);
        await cleanup(client2);
      }
    });

    it('handles concurrent reaction updates (CRDT)', async () => {
      const client1 = createTestClient();
      const client2 = createTestClient();

      try {
        const collection1 = createCommentsCollection(client1, TEST_COLLECTION);
        const collection2 = createCommentsCollection(client2, TEST_COLLECTION);

        await Promise.all([waitForReady(collection1), waitForReady(collection2)]);

        const commentId = 'test-concurrent-comment';

        // Client 1 creates comment with reactions
        const createTx = collection1.insert({
          id: commentId,
          postId: 'post-123',
          authorId: 'user-1',
          content: 'Comment to react to',
          isEdited: false,
          reactions: {
            likes: 0,
            hearts: 0,
            laughs: 0,
          },
        });
        await createTx.isPersisted.promise;

        // Wait for both clients to have the comment
        await waitForComment(collection1, (c) => c.id === commentId, 15000);
        await waitForComment(collection2, (c) => c.id === commentId, 15000);

        // Both clients update reactions simultaneously
        // Client 1 adds likes, Client 2 adds hearts
        const update1 = collection1.update(commentId, (draft) => {
          if (draft.reactions) {
            draft.reactions.likes = 5;
          }
        });
        const update2 = collection2.update(commentId, (draft) => {
          if (draft.reactions) {
            draft.reactions.hearts = 3;
          }
        });

        await Promise.all([update1.isPersisted.promise, update2.isPersisted.promise]);

        // Wait for sync to settle
        await new Promise((r) => setTimeout(r, 2000));

        // Both clients should converge
        const items1 = Array.from(collection1.state.values()) as Comment[];
        const items2 = Array.from(collection2.state.values()) as Comment[];

        const comment1 = items1.find((c) => c.id === commentId);
        const comment2 = items2.find((c) => c.id === commentId);

        // Both should have same reactions (converged via CRDT)
        expect(comment1?.reactions?.likes).toBe(comment2?.reactions?.likes);
        expect(comment1?.reactions?.hearts).toBe(comment2?.reactions?.hearts);

        // CRITICAL: Should only have 1 document with this ID (merged, not duplicated)
        const matchingDocs1 = items1.filter((c) => c.id === commentId);
        const matchingDocs2 = items2.filter((c) => c.id === commentId);
        expect(matchingDocs1.length).toBe(1);
        expect(matchingDocs2.length).toBe(1);
      } finally {
        await cleanup(client1);
        await cleanup(client2);
      }
    });

    it('syncs comment deletion between clients', async () => {
      const client1 = createTestClient();
      const client2 = createTestClient();

      try {
        const collection1 = createCommentsCollection(client1, TEST_COLLECTION);
        const collection2 = createCommentsCollection(client2, TEST_COLLECTION);

        await Promise.all([waitForReady(collection1), waitForReady(collection2)]);

        const commentId = 'test-sync-delete-comment';

        // Client 1 creates comment
        const createTx = collection1.insert({
          id: commentId,
          postId: 'post-123',
          authorId: 'user-1',
          content: 'Will be deleted',
          isEdited: false,
        });
        await createTx.isPersisted.promise;

        // Wait for both to see it
        await waitForComment(collection1, (c) => c.id === commentId, 15000);
        await waitForComment(collection2, (c) => c.id === commentId, 15000);

        // Client 1 deletes
        const deleteTx = collection1.delete(commentId);
        await deleteTx.isPersisted.promise;

        // Client 2 should see deletion
        await waitForCommentRemoval(collection2, commentId);
        const items2 = Array.from(collection2.state.values()) as Comment[];
        const found = items2.find((c) => c.id === commentId);
        expect(found).toBeUndefined();
      } finally {
        await cleanup(client1);
        await cleanup(client2);
      }
    });
  });
});
