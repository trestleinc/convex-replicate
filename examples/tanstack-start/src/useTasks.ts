import { createSchema, property, useConvexRx } from '@convex-rx/react';
import { api } from '../convex/_generated/api';

// ========================================
// TASK TYPE AND SCHEMA
// ========================================

// Define your data type - that's it!
// Note: createSchema automatically adds id, updatedTime, _deleted fields
export type Task = {
  text: string;
  isCompleted: boolean;
};

// Create schema using the simple builder API
// Auto-adds required fields: id, updatedTime, _deleted
const taskSchema = createSchema<Task>('tasks', {
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

// ========================================
// THAT'S IT! NOW WITH EXTENSIBILITY
// ========================================
//
// What you get:
// - Automatic schema generation with type safety
// - Built-in singleton management (no race conditions)
// - Automatic conflict resolution (last-write-wins)
// - Real-time sync via WebSocket change stream
// - Offline-first writes with automatic retry
// - Cross-tab synchronization
// - Type-safe base CRUD operations: insert, update, delete
// - Type-safe custom actions: toggle, completeAll
// - Type-safe custom queries: getCompleted, getIncomplete, count
//
// Usage in components:
//
// const { data, status, actions, queries } = useTasks();
//
// // Base CRUD (always available in actions)
// actions.insert({ text: 'New task', isCompleted: false });
// actions.update(id, { isCompleted: true });
// actions.delete(id);
//
// // Custom actions (fully typed!)
// actions.toggle(id);
// actions.completeAll();
//
// // Custom queries (fully typed!)
// const completed = queries.getCompleted();
// const incomplete = queries.getIncomplete();
// const count = queries.count();
//
// // Access raw data
// data.map(task => ...)
//
