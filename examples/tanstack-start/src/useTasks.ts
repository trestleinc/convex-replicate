import {
  createSchema,
  property,
  useConvexRx,
  addCRDTToSchema,
  type SyncedDocument,
} from '@convex-rx/react';
import { api } from '../convex/_generated/api';

// ========================================
// TASK TYPE AND SCHEMA
// ========================================

// Full task type including required sync fields (id, creationTime, updatedTime, _deleted)
// Using interface extends (not type intersection) to avoid index signature issues
export interface Task extends SyncedDocument {
  text: string;
  isCompleted: boolean;
}

// Create schema using the simple builder API
// Pass just the custom fields - sync fields are added automatically
const baseSchema = createSchema<Omit<Task, keyof SyncedDocument>>('tasks', {
  text: property.string(),
  isCompleted: property.boolean(),
});

// Add CRDT support for conflict-free replication
const taskSchema = addCRDTToSchema(baseSchema);

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

    // Base actions automatically use CRDT when schema has CRDT enabled
    // No need for custom CRDT wrappers - it's all handled intelligently!
    actions: (base, ctx) => ({
      ...base, // insert, update, delete automatically use CRDT

      // Optional convenience methods
      toggle: async (id: string) => {
        const task = await ctx.rxCollection.findOne(id).exec();
        if (task) {
          await base.update(id, { isCompleted: !task.isCompleted } as Partial<Task>);
        }
      },

      completeAll: async () => {
        const tasks = await ctx.rxCollection.find().exec();
        if (tasks) {
          await Promise.all(
            tasks.map((task) => base.update(task.id, { isCompleted: true } as Partial<Task>))
          );
        }
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
