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
    // Get all tasks and find the max updatedTime
    // This ensures ANY update (including deletions) triggers a sync on other clients
    const allTasks = await ctx.db.query('tasks').collect();

    // Use deterministic for-loop instead of Math.max to avoid re-evaluation issues
    let latestTime = 0;
    for (const task of allTasks) {
      if (task.updatedTime > latestTime) {
        latestTime = task.updatedTime;
      }
    }

    return {
      timestamp: latestTime || Date.now(),
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
    checkpoint: v.union(
      v.null(),
      v.object({
        id: v.string(),
        updatedTime: v.number(),
      })
    ),
    limit: v.number(),
  },
  handler: async (ctx, { checkpoint, limit }) => {
    let tasks: any;

    if (!checkpoint || (checkpoint.id === '' && checkpoint.updatedTime === 0)) {
      // Initial pull - get most recent documents
      tasks = await ctx.db.query('tasks').order('desc').take(limit);
    } else {
      // Incremental pull - get documents newer than checkpoint
      // Must handle BOTH updatedTime and id for proper ordering
      tasks = await ctx.db
        .query('tasks')
        .filter((q) =>
          q.or(
            q.gt(q.field('updatedTime'), checkpoint.updatedTime),
            q.and(
              q.eq(q.field('updatedTime'), checkpoint.updatedTime),
              q.gt(q.field('id'), checkpoint.id)
            )
          )
        )
        .order('desc')
        .take(limit);
    }

    // Map to clean task objects (including deleted field)
    const documents = tasks.map((task: any) => ({
      id: task.id,
      text: task.text,
      isCompleted: task.isCompleted,
      updatedTime: task.updatedTime,
      deleted: task.deleted || false,
    }));

    // Calculate new checkpoint from returned documents
    const newCheckpoint =
      documents.length > 0
        ? { id: documents[0].id, updatedTime: documents[0].updatedTime }
        : checkpoint || { id: '', updatedTime: 0 };

    return {
      documents,
      checkpoint: newCheckpoint,
    };
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
          deleted: v.optional(v.boolean()),
        }),
        assumedMasterState: v.optional(
          v.object({
            id: v.string(),
            text: v.string(),
            isCompleted: v.boolean(),
            updatedTime: v.number(),
            deleted: v.optional(v.boolean()),
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
            deleted: currentDoc.deleted || false,
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

        if (currentDoc) {
          // Update existing document (including soft delete)
          await ctx.db.patch(currentDoc._id, {
            text: newDocumentState.text,
            isCompleted: newDocumentState.isCompleted,
            updatedTime: timestamp,
            deleted: newDocumentState.deleted || false,
          });
        } else {
          // Insert new document
          await ctx.db.insert('tasks', {
            id: newDocumentState.id,
            text: newDocumentState.text,
            isCompleted: newDocumentState.isCompleted,
            updatedTime: timestamp,
            deleted: newDocumentState.deleted || false,
          });
        }
      }
    }
    return conflicts;
  },
});
