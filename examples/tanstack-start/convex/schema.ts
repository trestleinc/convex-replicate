import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  tasks: defineTable({
    id: v.string(),
    text: v.string(),
    isCompleted: v.boolean(),
    version: v.number(),
    timestamp: v.number(),
    // Keep deleted field optional for backwards compatibility with existing data
    // New items won't have it, but old items might
    deleted: v.optional(v.boolean()),
  })
    .index('by_user_id', ['id'])
    .index('by_timestamp', ['timestamp']),
});
