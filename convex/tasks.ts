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

// RxDB Replication: Pull documents since checkpoint
export const pullDocuments = query({
  args: {
    checkpointId: v.string(),
    checkpointTime: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, { checkpointId, checkpointTime, limit }) => {
    // Query documents that have been updated since the checkpoint
    // We need to compare both updatedTime AND id for deterministic ordering
    const tasks = await ctx.db
      .query("tasks")
      .filter((q) => 
        q.or(
          q.gt(q.field("updatedTime"), checkpointTime),
          q.and(
            q.eq(q.field("updatedTime"), checkpointTime),
            q.gt(q.field("id"), checkpointId)
          )
        )
      )
      .order("asc")
      .take(limit);
    
    // Return only client-side fields (exclude Convex _id, _creationTime)
    return tasks.map(task => ({
      id: task.id,
      text: task.text,
      isCompleted: task.isCompleted,
      updatedTime: task.updatedTime
    }));
  },
});

// RxDB Replication: Push changes and detect conflicts
export const pushDocuments = mutation({
  args: {
    changeRows: v.array(v.object({
      newDocumentState: v.object({
        id: v.string(),
        text: v.string(),
        isCompleted: v.boolean(),
        updatedTime: v.number(),
        _deleted: v.optional(v.boolean())
      }),
      assumedMasterState: v.optional(v.object({
        id: v.string(),
        text: v.string(),
        isCompleted: v.boolean(),
        updatedTime: v.number(),
        _deleted: v.optional(v.boolean())
      }))
    }))
  },
  handler: async (ctx, { changeRows }) => {
    const conflicts = [];
    
    for (const changeRow of changeRows) {
      const { newDocumentState, assumedMasterState } = changeRow;
      
      // Find current document state on server
      const currentDoc = await ctx.db
        .query("tasks")
        .filter((q) => q.eq(q.field("id"), newDocumentState.id))
        .first();
      
      // Convert current doc to client format for comparison
      const realMasterState = currentDoc ? {
        id: currentDoc.id,
        text: currentDoc.text,
        isCompleted: currentDoc.isCompleted,
        updatedTime: currentDoc.updatedTime
      } : null;
      
      // Detect conflicts
      const hasConflict = 
        realMasterState && !assumedMasterState ||
        (realMasterState && assumedMasterState &&
         realMasterState.updatedTime !== assumedMasterState.updatedTime);
      
      if (hasConflict) {
        // Conflict detected - return current server state
        conflicts.push(realMasterState);
      } else {
        // No conflict - apply the change
        if (newDocumentState._deleted) {
          // Handle deletion
          if (currentDoc) {
            await ctx.db.delete(currentDoc._id);
          }
        } else {
          // Handle insert/update
          if (currentDoc) {
            // Update existing
            await ctx.db.patch(currentDoc._id, {
              text: newDocumentState.text,
              isCompleted: newDocumentState.isCompleted,
              updatedTime: newDocumentState.updatedTime
            });
          } else {
            // Insert new
            await ctx.db.insert("tasks", {
              id: newDocumentState.id,
              text: newDocumentState.text,
              isCompleted: newDocumentState.isCompleted,
              updatedTime: newDocumentState.updatedTime
            });
          }
        }
      }
    }
    
    return conflicts;
  },
});
