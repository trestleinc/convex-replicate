import { createSchema, property, useConvexRxSimple } from '@convex-rx/react';
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
// EFFORTLESS HOOK
// ========================================

/**
 * Hook to access tasks with full offline-first sync.
 * Returns: { data, isLoading, error, insert, update, delete, purgeStorage }
 */
export function useTasks() {
  return useConvexRxSimple<Task>('tasks', {
    schema: taskSchema,
    convexClient,
    convexApi: {
      changeStream: api.tasks.changeStream,
      pullDocuments: api.tasks.pullDocuments,
      pushDocuments: api.tasks.pushDocuments,
    },
    enableLogging: true,
  });
}

// ========================================
// THAT'S IT! 30 LINES INSTEAD OF 200
// ========================================
//
// What you get:
// - Automatic schema generation with type safety
// - Built-in singleton management (no race conditions)
// - Automatic conflict resolution (last-write-wins)
// - Real-time sync via WebSocket change stream
// - Offline-first writes with automatic retry
// - Cross-tab synchronization
// - Type-safe CRUD operations
//
// What disappeared:
// - Manual RxJsonSchema boilerplate
// - Singleton pattern with race condition handling
// - Complex initialization logic
// - Manual error handling
// - Action hook pattern
// - HMR cleanup boilerplate
