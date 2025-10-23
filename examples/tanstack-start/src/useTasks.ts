import { createSchema, property, useConvexRx, type SyncedDocument } from '@convex-rx/react';
import { api } from '../convex/_generated/api';

// ========================================
// TASK TYPE AND SCHEMA
// ========================================

// Full task type including required sync fields (id, updatedTime, _deleted)
// Using interface extends (not type intersection) to avoid index signature issues
export interface Task extends SyncedDocument {
  text: string;
  isCompleted: boolean;
}

// Create schema using the simple builder API
// Pass just the custom fields - sync fields are added automatically
const taskSchema = createSchema<Omit<Task, keyof SyncedDocument>>('tasks', {
  text: property.string(),
  isCompleted: property.boolean(),
});

// ========================================
// EFFORTLESS HOOK - NEW UNIFIED API
// ========================================

/**
 * Hook to access tasks with full offline-first sync.
 * Uses the new unified useConvexRx hook.
 *
 * @param initialData - Optional SSR data for instant hydration
 * Returns: { data, status, actions, queries, subscribe, purgeStorage }
 */
export function useTasks(initialData?: Task[]) {
  return useConvexRx({
    table: 'tasks',
    schema: taskSchema,
    convexApi: {
      changeStream: api.tasks.changeStream,
      pullDocuments: api.tasks.pullDocuments,
      pushDocuments: api.tasks.pushDocuments,
    },
    initialData,
    // Storage defaults to Dexie.js (IndexedDB) for 5-10x better performance
    // No configuration needed!
    // Note: convexClient and enableLogging are provided by ConvexRxProvider

    // Optional: Add custom actions
    actions: (base, ctx) => ({
      // Toggle completion status
      toggle: async (id: string) => {
        const task = await ctx.rxCollection.findOne(id).exec();
        if (task) {
          await base.update(id, { isCompleted: !task.isCompleted });
        }
      },

      // Complete all tasks
      completeAll: async () => {
        const tasks = ctx.collection.toArray;
        await Promise.all(tasks.map((task) => base.update(task.id, { isCompleted: true })));
      },
    }),

    // Optional: Add custom queries
    queries: (ctx) => ({
      // Get completed tasks
      getCompleted: () => ctx.collection.toArray.filter((task) => task.isCompleted),

      // Get incomplete tasks
      getIncomplete: () => ctx.collection.toArray.filter((task) => !task.isCompleted),

      // Count tasks
      count: () => ctx.collection.toArray.length,
    }),
  });
}
