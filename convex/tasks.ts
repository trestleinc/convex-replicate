import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tasks").collect();
  },
});

export const create = mutation({
  args: { 
    id: v.string(), // Client-side generated ID
    text: v.string(),
    isCompleted: v.optional(v.boolean()),
    updatedTime: v.optional(v.number()),
  },
  handler: async (ctx, { id, text, isCompleted = false, updatedTime }) => {
    return await ctx.db.insert("tasks", { 
      id, 
      text, 
      isCompleted,
      updatedTime: updatedTime || Date.now()
    });
  },
});

export const update = mutation({
  args: {
    id: v.string(), // Client-side ID (always string)
    text: v.optional(v.string()),
    isCompleted: v.optional(v.boolean()),
    updatedTime: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...updates }) => {
    // Find the task by client-side id field (not Convex _id)
    const existingTask = await ctx.db
      .query("tasks")
      .filter((q) => q.eq(q.field("id"), id))
      .first();
    
    if (existingTask) {
      return await ctx.db.patch(existingTask._id, {
        ...updates,
        updatedTime: updates.updatedTime || Date.now()
      });
    } else {
      // Task doesn't exist in Convex yet
      console.warn("Task not found for update:", id);
      return null;
    }
  },
});
