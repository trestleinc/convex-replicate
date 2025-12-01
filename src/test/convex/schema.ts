import { defineSchema } from 'convex/server';
import { v } from 'convex/values';
import { replicatedTable } from '@trestleinc/replicate/server';

export default defineSchema({
  // Simple tasks for basic integration tests (existing tests use this)
  tasks: replicatedTable(
    {
      id: v.string(),
      text: v.string(),
      isCompleted: v.boolean(),
    },
    (table) => table.index('by_task_id', ['id']).index('by_timestamp', ['timestamp'])
  ),

  // Users - realistic user profiles for multi-client sync tests
  users: replicatedTable(
    {
      id: v.string(),
      email: v.string(),
      displayName: v.string(),
      avatarUrl: v.optional(v.string()),
      bio: v.optional(v.string()),
      isOnline: v.boolean(),
      lastSeenAt: v.optional(v.number()),
      preferences: v.optional(
        v.object({
          theme: v.union(v.literal('light'), v.literal('dark'), v.literal('system')),
          notifications: v.boolean(),
          language: v.string(),
        })
      ),
    },
    (table) =>
      table
        .index('by_user_id', ['id'])
        .index('by_email', ['email'])
        .index('by_timestamp', ['timestamp'])
  ),

  // Posts - content with nested objects for compaction tests (many deltas)
  posts: replicatedTable(
    {
      id: v.string(),
      authorId: v.string(),
      title: v.string(),
      content: v.string(),
      excerpt: v.optional(v.string()),
      publishedAt: v.optional(v.number()),
      status: v.union(v.literal('draft'), v.literal('published'), v.literal('archived')),
      tags: v.array(v.string()),
      viewCount: v.number(),
      likeCount: v.number(),
      metadata: v.optional(
        v.object({
          readingTime: v.number(),
          wordCount: v.number(),
          featuredImage: v.optional(v.string()),
        })
      ),
    },
    (table) =>
      table
        .index('by_post_id', ['id'])
        .index('by_author', ['authorId'])
        .index('by_status', ['status'])
        .index('by_timestamp', ['timestamp'])
  ),

  // Comments - for testing concurrent edits and CRDT conflict resolution
  comments: replicatedTable(
    {
      id: v.string(),
      postId: v.string(),
      authorId: v.string(),
      parentId: v.optional(v.string()), // For threaded comments
      content: v.string(),
      isEdited: v.boolean(),
      editedAt: v.optional(v.number()),
      reactions: v.optional(
        v.object({
          likes: v.number(),
          hearts: v.number(),
          laughs: v.number(),
        })
      ),
    },
    (table) =>
      table
        .index('by_comment_id', ['id'])
        .index('by_post', ['postId'])
        .index('by_author', ['authorId'])
        .index('by_parent', ['parentId'])
        .index('by_timestamp', ['timestamp'])
  ),
});
