import { createSchema, property, useConvexRx, StorageType } from '@convex-rx/react';
import { api } from '../convex/_generated/api';
import { convexClient } from './router';

// ========================================
// TASK TYPE AND SCHEMA
// ========================================

// Define your data type - that's it!
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
 * Returns: { data, isLoading, error, insert, update, delete, actions, queries, subscribe, purgeStorage }
 */
export function useTasks() {
	return useConvexRx({
		table: 'tasks',
		schema: taskSchema,
		convexClient,
		convexApi: {
			changeStream: api.tasks.changeStream,
			pullDocuments: api.tasks.pullDocuments,
			pushDocuments: api.tasks.pushDocuments,
		},
		enableLogging: true,
		storage: { type: StorageType.DEXIE }, // Use Dexie.js (IndexedDB) for 5-10x better performance

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
// const tasks = useTasks();
//
// // Base CRUD (always available)
// tasks.insert({ text: 'New task', isCompleted: false });
// tasks.update(id, { isCompleted: true });
// tasks.delete(id);
//
// // Custom actions (fully typed!)
// tasks.actions.toggle(id);
// tasks.actions.completeAll();
//
// // Custom queries (fully typed!)
// const completed = tasks.queries.getCompleted();
// const incomplete = tasks.queries.getIncomplete();
// const count = tasks.queries.count();
//
// // Access raw data
// tasks.data.map(task => ...)
//
