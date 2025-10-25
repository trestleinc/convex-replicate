import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  tasks: defineTable({
    id: v.string(),
    text: v.string(),
    isCompleted: v.boolean(),
    version: v.number(),
    timestamp: v.number(),
  })
    .index('by_user_id', ['id'])
    .index('by_timestamp', ['timestamp']),
});
