import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tasks").collect();
  },
});

// Simple change stream for WebSocket real-time updates
export const changeStream = query({
  args: {},
  handler: async (ctx) => {
    // Get count and latest timestamp - simple and reliable
    const allTasks = await ctx.db.query("tasks").order("desc").collect();
    const latestTime = allTasks.length > 0 ? allTasks[0].updatedTime : Date.now();
    
    return {
      timestamp: latestTime,
      count: allTasks.length
    };
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
    const timestamp = updatedTime || Date.now();
    console.log(`[Convex] Creating task ${id} with timestamp ${timestamp}`);
    
    const result = await ctx.db.insert("tasks", { 
      id, 
      text, 
      isCompleted,
      updatedTime: timestamp
    });
    
    console.log(`[Convex] Task created successfully: ${id}`);
    return result;
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
    const timestamp = updates.updatedTime || Date.now();
    console.log(`[Convex] Updating task ${id} with timestamp ${timestamp}`);
    
    // Find the task by client-side id field (not Convex _id)
    const existingTask = await ctx.db
      .query("tasks")
      .filter((q) => q.eq(q.field("id"), id))
      .first();
    
    if (existingTask) {
      const result = await ctx.db.patch(existingTask._id, {
        ...updates,
        updatedTime: timestamp
      });
      console.log(`[Convex] Task updated successfully: ${id}`);
      return result;
    } else {
      // Task doesn't exist in Convex yet
      console.warn(`[Convex] Task not found for update: ${id}`);
      return null;
    }
  },
});

// RxDB Replication: Pull documents since checkpoint
export const pullDocuments = query({
  args: {
    checkpointTime: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, { checkpointTime, limit }) => {
    console.log(`[Convex] pullDocuments: checkpoint=${checkpointTime}, limit=${limit}`);
    
    // Simple query: get all tasks newer than checkpoint, ordered by time
    const tasks = await ctx.db
      .query("tasks")
      .filter((q) => q.gt(q.field("updatedTime"), checkpointTime))
      .order("desc") // Most recent first for consistency with changeStream
      .take(limit);
    
    // Return clean task objects
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
    console.log(`[Convex] pushDocuments called with ${changeRows.length} change rows`);
    const conflicts = [];
    
    for (const changeRow of changeRows) {
      const { newDocumentState, assumedMasterState } = changeRow;
      console.log(`[Convex] Processing change for task: ${newDocumentState.id}`);
      
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
        console.log(`[Convex] Conflict detected for task ${newDocumentState.id}`);
        conflicts.push(realMasterState);
      } else {
        // No conflict - apply the change
        const timestamp = newDocumentState.updatedTime || Date.now();
        
        if (newDocumentState._deleted) {
          // Handle deletion
          console.log(`[Convex] Deleting task: ${newDocumentState.id}`);
          if (currentDoc) {
            await ctx.db.delete(currentDoc._id);
          }
        } else {
          // Handle insert/update
          if (currentDoc) {
            // Update existing
            console.log(`[Convex] Updating existing task: ${newDocumentState.id} with timestamp ${timestamp}`);
            await ctx.db.patch(currentDoc._id, {
              text: newDocumentState.text,
              isCompleted: newDocumentState.isCompleted,
              updatedTime: timestamp
            });
          } else {
            // Insert new
            console.log(`[Convex] Inserting new task: ${newDocumentState.id} with timestamp ${timestamp}`);
            await ctx.db.insert("tasks", {
              id: newDocumentState.id,
              text: newDocumentState.text,
              isCompleted: newDocumentState.isCompleted,
              updatedTime: timestamp
            });
          }
        }
      }
    }
    
    console.log(`[Convex] pushDocuments completed with ${conflicts.length} conflicts`);
    return conflicts;
  },
});
