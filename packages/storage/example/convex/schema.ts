import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  users: defineTable({
    name: v.string(),
  }),
  backfillCursor: defineTable({
    creationTime: v.number(),
    id: v.string(),
    isDone: v.boolean(),
  }),
  checkboxes: defineTable({
    idx: v.number(),
    boxes: v.bytes(),
  }).index('idx', ['idx']),
});
