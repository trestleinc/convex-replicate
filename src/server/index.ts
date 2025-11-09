/**
 * Server-side utilities for Convex backend.
 * Import this in your Convex functions (convex/*.ts files).
 *
 * @example
 * ```typescript
 * // convex/tasks.ts
 * import { ReplicateStorage } from '@trestleinc/replicate/server';
 * import { components } from './_generated/api';
 * import type { Task } from '../src/useTasks';
 *
 * const tasksStorage = new ReplicateStorage<Task>(components.replicate, 'tasks');
 *
 * export const streamCRDT = tasksStorage.createStreamQuery();
 * export const getTasks = tasksStorage.createSSRQuery();
 * export const insertDocument = tasksStorage.createInsertMutation();
 * export const updateDocument = tasksStorage.createUpdateMutation();
 * export const deleteDocument = tasksStorage.createDeleteMutation();
 * ```
 */

// Main wrapper class for replicate component operations
export { ReplicateStorage } from './storage.js';

// Schema utilities
export { replicatedTable, type ReplicationFields } from './schema.js';
