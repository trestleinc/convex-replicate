import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tasks").collect();
  },
});

// Database change stream for real-time updates
// This query provides a change stream that all clients can subscribe to
// It returns all tasks with a timestamp, allowing clients to detect any database changes
export const changeStream = query({
  args: {
    lastSeenTime: v.optional(v.number()), // Last change timestamp the client has seen
  },
  handler: async (ctx, { lastSeenTime = 0 }) => {
    console.log(`[Convex] changeStream called with lastSeenTime: ${lastSeenTime}`);
    
    try {
      // Get all tasks ordered by updatedTime to create a consistent change stream
      const allTasks = await ctx.db
        .query("tasks")
        .order("desc") // Most recent first
        .collect();
      
      // Find the most recent change time
      const latestChangeTime = allTasks.length > 0 ? allTasks[0].updatedTime : Date.now();
      
      // Determine if there are changes since the client's last seen time
      const hasChanges = latestChangeTime > lastSeenTime;
      
      console.log(`[Convex] changeStream: ${allTasks.length} tasks, latestChangeTime: ${latestChangeTime}, hasChanges: ${hasChanges}`);
      
      return {
        // Always return the current timestamp so clients can track the latest state
        timestamp: latestChangeTime,
        // Include change indicator to help clients optimize polling
        hasChanges,
        // Optionally include task count for change detection
        taskCount: allTasks.length,
        // Include a changeId based on latest timestamp for more reliable change detection
        changeId: `change-${latestChangeTime}-${allTasks.length}`
      };
    } catch (error) {
      console.error('[Convex] changeStream error:', error);
      return {
        timestamp: Date.now(),
        hasChanges: false,
        taskCount: 0,
        changeId: `error-${Date.now()}`
      };
    }
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
    checkpointId: v.string(),
    checkpointTime: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, { checkpointId, checkpointTime, limit }) => {
    try {
      console.log(`[Convex] pullDocuments called with checkpoint: {id: "${checkpointId}", time: ${checkpointTime}}, limit: ${limit}`);
      
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
      
      // Comprehensive null/undefined safety
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      console.log(`[Convex] Found ${safeTasks.length} tasks to replicate`);
      
      // Return only client-side fields (exclude Convex _id, _creationTime)
      // Each task must be a valid object with all required fields
      const processedTasks = safeTasks
        .filter(task => task && typeof task === 'object') // Filter out null/undefined tasks
        .map(task => {
          // Ensure all required fields exist with proper types
          const processedTask = {
            id: typeof task.id === 'string' ? task.id : '',
            text: typeof task.text === 'string' ? task.text : '',
            isCompleted: typeof task.isCompleted === 'boolean' ? task.isCompleted : false,
            updatedTime: typeof task.updatedTime === 'number' ? task.updatedTime : Date.now()
          };
          
          console.log(`[Convex] Processing task: ${processedTask.id}`);
          return processedTask;
        });
      
      console.log(`[Convex] Returning ${processedTasks.length} processed tasks`);
      return processedTasks;
      
    } catch (error) {
      console.error(`[Convex] pullDocuments error:`, error);
      // Always return an empty array on error to prevent RxDB crashes
      return [];
    }
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
