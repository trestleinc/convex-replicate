import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect();
  },
});

// Simple change stream for WebSocket real-time updates
export const changeStream = query({
  args: {},
  handler: async (ctx) => {
    // Get count and latest timestamp - simple and reliable
    const allTasks = await ctx.db.query('tasks').order('desc').collect();
    const latestTime = allTasks.length > 0 ? allTasks[0].updatedTime : Date.now();

    return {
      timestamp: latestTime,
      count: allTasks.length,
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
    id: v.string(), // Client-side ID (always string)
    text: v.optional(v.string()),
    isCompleted: v.optional(v.boolean()),
    updatedTime: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...updates }) => {
    const timestamp = updates.updatedTime || Date.now();

    // Find the task by client-side id field (not Convex _id)
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
    } else {
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
    // Simple query: get all tasks newer than checkpoint, ordered by time
    const tasks = await ctx.db
      .query('tasks')
      .filter((q) => q.gt(q.field('updatedTime'), checkpointTime))
      .order('desc') // Most recent first for consistency with changeStream
      .take(limit);

    // Return clean task objects
    return tasks.map((task) => ({
      id: task.id,
      text: task.text,
      isCompleted: task.isCompleted,
      updatedTime: task.updatedTime,
    }));
  },
});

// RxDB Replication: Push changes and detect conflicts
export const pushDocuments = mutation({
  args: {
    changeRows: v.array(
      v.object({
        newDocumentState: v.object({
          id: v.string(),
          text: v.string(),
          isCompleted: v.boolean(),
          updatedTime: v.number(),
          _deleted: v.optional(v.boolean()),
        }),
        assumedMasterState: v.optional(
          v.object({
            id: v.string(),
            text: v.string(),
            isCompleted: v.boolean(),
            updatedTime: v.number(),
            _deleted: v.optional(v.boolean()),
          })
        ),
      })
    ),
  },
  handler: async (ctx, { changeRows }) => {
    const conflicts = [];

    for (const changeRow of changeRows) {
      const { newDocumentState, assumedMasterState } = changeRow;

      // Find current document state on server
      const currentDoc = await ctx.db
        .query('tasks')
        .filter((q) => q.eq(q.field('id'), newDocumentState.id))
        .first();

      // Convert current doc to client format for comparison
      const realMasterState = currentDoc
        ? {
            id: currentDoc.id,
            text: currentDoc.text,
            isCompleted: currentDoc.isCompleted,
            updatedTime: currentDoc.updatedTime,
          }
        : null;

      // Detect conflicts
      const hasConflict =
        (realMasterState && !assumedMasterState) ||
        (realMasterState &&
          assumedMasterState &&
          realMasterState.updatedTime !== assumedMasterState.updatedTime);

      if (hasConflict) {
        conflicts.push(realMasterState);
      } else {
        // No conflict - apply the change
        const timestamp = newDocumentState.updatedTime || Date.now();

        if (newDocumentState._deleted) {
          if (currentDoc) {
            await ctx.db.delete(currentDoc._id);
          }
        } else {
          // Handle insert/update
          if (currentDoc) {
            await ctx.db.patch(currentDoc._id, {
              text: newDocumentState.text,
              isCompleted: newDocumentState.isCompleted,
              updatedTime: timestamp,
            });
          } else {
            await ctx.db.insert('tasks', {
              id: newDocumentState.id,
              text: newDocumentState.text,
              isCompleted: newDocumentState.isCompleted,
              updatedTime: timestamp,
            });
          }
        }
      }
    }
    return conflicts;
  },
});
