/**
 * Test Collection Helper
 *
 * Creates a fully-functional TanStack DB collection with Convex backend
 * for browser-based integration testing. Uses the real replicate client
 * with CRDT encoding, persistence, and sync.
 */

import { createCollection } from '@tanstack/db';
import { ConvexClient } from 'convex/browser';
import { convexCollectionOptions, handleReconnect, type ConvexCollection } from '$/client/index.js';
import { api } from '../convex/_generated/api';

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

export interface Post {
  id: string;
  authorId: string;
  title: string;
  content: string;
  excerpt?: string;
  publishedAt?: number;
  status: 'draft' | 'published' | 'archived';
  tags: string[];
  viewCount: number;
  likeCount: number;
  metadata?: {
    readingTime: number;
    wordCount: number;
    featuredImage?: string;
  };
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  isOnline: boolean;
  lastSeenAt?: number;
  preferences?: {
    theme: 'light' | 'dark' | 'system';
    notifications: boolean;
    language: string;
  };
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  parentId?: string;
  content: string;
  isEdited: boolean;
  editedAt?: number;
  reactions?: {
    likes: number;
    hearts: number;
    laughs: number;
  };
}

// Get Convex URL from environment (works in both Node and Vite/browser)
// In Vite browser mode, import.meta.env is available; in Node, process.env is available
function getConvexUrl(): string | undefined {
  // Check Vite's import.meta.env first (browser mode)
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CONVEX_URL) {
    return import.meta.env.VITE_CONVEX_URL;
  }
  // Fallback to process.env (Node mode) - safely check if process exists
  if (typeof process !== 'undefined' && process.env?.CONVEX_URL) {
    return process.env.CONVEX_URL;
  }
  return undefined;
}

const CONVEX_URL = getConvexUrl();

/**
 * Creates a test Convex client connected to the real backend
 */
export function createTestClient(): ConvexClient {
  if (!CONVEX_URL) {
    throw new Error('CONVEX_URL not set. Run `cd src/test && npx convex dev` first.');
  }
  return new ConvexClient(CONVEX_URL);
}

/**
 * Creates a fully-functional tasks collection for testing.
 * This uses the complete client stack:
 * - TanStack DB for reactive state
 * - Yjs for CRDT encoding
 * - IndexedDB for persistence
 * - Convex for sync
 */
export function createTestCollection(convexClient: ConvexClient): ConvexCollection<Task> {
  const rawCollection = createCollection(
    convexCollectionOptions<Task>({
      convexClient,
      api: api.tasks,
      collection: `tasks-test-${Date.now()}`, // Unique per test run
      getKey: (task) => task.id,
    })
  );

  return handleReconnect(rawCollection);
}

/**
 * Creates a tasks collection with a specific collection name.
 * Useful for multi-client sync tests.
 */
export function createTestCollectionWithName(
  convexClient: ConvexClient,
  collectionName: string
): ConvexCollection<Task> {
  const rawCollection = createCollection(
    convexCollectionOptions<Task>({
      convexClient,
      api: api.tasks,
      collection: collectionName,
      getKey: (task) => task.id,
    })
  );

  return handleReconnect(rawCollection);
}

/**
 * Wait for a collection to be ready (sync complete)
 * Generic version that works with any entity type
 */
export async function waitForReady<T extends { id: string }>(
  collection: ConvexCollection<T>,
  timeoutMs = 10000
): Promise<void> {
  // Use stateWhenReady which waits for first sync commit
  await Promise.race([
    collection.stateWhenReady(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Collection not ready after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * Wait for a specific item to appear in the collection
 */
export async function waitForItem(
  collection: ConvexCollection<Task>,
  predicate: (task: Task) => boolean,
  timeoutMs = 10000
): Promise<Task> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const items = Array.from(collection.state.values()) as Task[];
    const found = items.find(predicate);
    if (found) {
      return found;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(`Item not found after ${timeoutMs}ms`);
}

/**
 * Wait for an item to be removed from the collection
 */
export async function waitForRemoval(
  collection: ConvexCollection<Task>,
  key: string,
  timeoutMs = 10000
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const items = Array.from(collection.state.values()) as Task[];
    const found = items.find((t) => t.id === key);
    if (!found) {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(`Item ${key} not removed after ${timeoutMs}ms`);
}

/**
 * Cleanup helper - closes client and cleans up collection
 */
export async function cleanup(
  client: ConvexClient,
  _collection?: ConvexCollection<Task>
): Promise<void> {
  // Collection cleanup is handled by TanStack DB internally
  await client.close();
}

/**
 * Creates a posts collection for testing compaction and complex data
 */
export function createPostsCollection(
  convexClient: ConvexClient,
  collectionName: string
): ConvexCollection<Post> {
  const rawCollection = createCollection(
    convexCollectionOptions<Post>({
      convexClient,
      api: api.posts,
      collection: collectionName,
      getKey: (post) => post.id,
    })
  );

  return handleReconnect(rawCollection);
}

/**
 * Wait for posts to appear in collection
 */
export async function waitForPost(
  collection: ConvexCollection<Post>,
  predicate: (post: Post) => boolean,
  timeoutMs = 10000
): Promise<Post> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const items = Array.from(collection.state.values()) as Post[];
    const found = items.find(predicate);
    if (found) {
      return found;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(`Post not found after ${timeoutMs}ms`);
}

/**
 * Creates a users collection for testing user profiles with nested objects
 */
export function createUsersCollection(
  convexClient: ConvexClient,
  collectionName: string
): ConvexCollection<User> {
  const rawCollection = createCollection(
    convexCollectionOptions<User>({
      convexClient,
      api: api.users,
      collection: collectionName,
      getKey: (user) => user.id,
    })
  );

  return handleReconnect(rawCollection);
}

/**
 * Wait for a user to appear in collection
 */
export async function waitForUser(
  collection: ConvexCollection<User>,
  predicate: (user: User) => boolean,
  timeoutMs = 10000
): Promise<User> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const items = Array.from(collection.state.values()) as User[];
    const found = items.find(predicate);
    if (found) {
      return found;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(`User not found after ${timeoutMs}ms`);
}

/**
 * Creates a comments collection for testing threaded comments and reactions
 */
export function createCommentsCollection(
  convexClient: ConvexClient,
  collectionName: string
): ConvexCollection<Comment> {
  const rawCollection = createCollection(
    convexCollectionOptions<Comment>({
      convexClient,
      api: api.comments,
      collection: collectionName,
      getKey: (comment) => comment.id,
    })
  );

  return handleReconnect(rawCollection);
}

/**
 * Wait for a comment to appear in collection
 */
export async function waitForComment(
  collection: ConvexCollection<Comment>,
  predicate: (comment: Comment) => boolean,
  timeoutMs = 10000
): Promise<Comment> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const items = Array.from(collection.state.values()) as Comment[];
    const found = items.find(predicate);
    if (found) {
      return found;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(`Comment not found after ${timeoutMs}ms`);
}

/**
 * Wait for a comment to be removed from the collection
 */
export async function waitForCommentRemoval(
  collection: ConvexCollection<Comment>,
  key: string,
  timeoutMs = 10000
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const items = Array.from(collection.state.values()) as Comment[];
    const found = items.find((c) => c.id === key);
    if (!found) {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(`Comment ${key} not removed after ${timeoutMs}ms`);
}

/**
 * Call compact mutation on a collection via admin wrapper
 * Note: Compaction requires 100+ deltas to trigger
 *
 * Uses api.admin.compactPosts (public test wrapper) instead of
 * api.posts.compact (internal mutation) which cannot be called from clients
 */
export async function compactCollection(
  client: ConvexClient,
  collection: string,
  retentionDays?: number
): Promise<{
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  deltasCompacted?: number;
  snapshotSize?: number;
}> {
  return client.mutation(api.admin.compactPosts, {
    collection,
    retentionDays,
  });
}

/**
 * Call prune mutation on a collection to remove old snapshots
 *
 * Uses api.admin.prunePosts (public test wrapper) instead of
 * api.posts.prune (internal mutation) which cannot be called from clients
 */
export async function pruneCollection(
  client: ConvexClient,
  collection: string,
  retentionDays?: number
): Promise<{
  collection: string;
  deletedCount: number;
  snapshotsRemaining: number;
}> {
  return client.mutation(api.admin.prunePosts, {
    collection,
    retentionDays,
  });
}
