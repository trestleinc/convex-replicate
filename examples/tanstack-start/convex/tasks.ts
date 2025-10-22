import { generateConvexRxFunctions } from '@convex-rx/core';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// ========================================
// AUTO-GENERATED CONVEX FUNCTIONS
// ========================================

// This single call generates all 3 required functions:
// - changeStream: Detects changes for real-time sync
// - pullDocuments: Pulls documents from server
// - pushDocuments: Pushes local changes to server
const taskFunctions = generateConvexRxFunctions({
  tableName: 'tasks',
  query,
  mutation,
  v,
});

export const changeStream = taskFunctions.changeStream;
export const pullDocuments = taskFunctions.pullDocuments;
export const pushDocuments = taskFunctions.pushDocuments;

// ========================================
// OPTIONAL: LEGACY CRUD FUNCTIONS
// (Not needed for ConvexRx, but useful for direct API access)
// ========================================

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    text: v.string(),
    isCompleted: v.optional(v.boolean()),
    updatedTime: v.optional(v.number()),
  },
  handler: async (ctx, { id, text, isCompleted = false, updatedTime }) => {
    const timestamp = updatedTime || Date.now();
    const result = await ctx.db.insert('tasks', {
      id,
      text,
      isCompleted,
      updatedTime: timestamp,
    });
    return result;
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    text: v.optional(v.string()),
    isCompleted: v.optional(v.boolean()),
    updatedTime: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...updates }) => {
    const timestamp = updates.updatedTime || Date.now();
    const existingTask = await ctx.db
      .query('tasks')
      .filter((q) => q.eq(q.field('id'), id))
      .first();

    if (existingTask) {
      const result = await ctx.db.patch(existingTask._id, {
        ...updates,
        updatedTime: timestamp,
      });
      return result;
    }
    return null;
  },
});
