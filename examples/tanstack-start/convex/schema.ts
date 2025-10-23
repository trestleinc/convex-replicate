import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Convex database schema definition.
 *
 * IMPORTANT: For optimal ConvexRx performance, always include these indexes
 * on synced tables:
 * - .index('by_creationTime', ['creationTime']) - For stable display ordering
 * - .index('by_updatedTime', ['updatedTime'])   - For efficient sync
 */
export default defineSchema({
  tasks: defineTable({
    // ConvexRx sync fields (required for all synced tables)
    id: v.string(), // Client-generated UUID
    creationTime: v.number(), // Creation timestamp (never changes)
    updatedTime: v.number(), // Last update timestamp (for sync)
    deleted: v.optional(v.boolean()), // Soft delete flag

    // Application fields
    text: v.string(),
    isCompleted: v.boolean(),
  })
    .index('by_creationTime', ['creationTime']) // For stable ordering
    .index('by_updatedTime', ['updatedTime']), // For efficient sync
});
