/**
 * Server-side utilities for Convex backend.
 * Import this in your Convex functions (convex/*.ts files).
 *
 * @example
 * ```typescript
 * // convex/tasks.ts
 * import { Replicate } from '@trestleinc/replicate/server';
 * import { components } from './_generated/api';
 * import type { Task } from '../src/useTasks';
 *
 * const tasksStorage = new Replicate<Task>(components.replicate, 'tasks');
 *
 * export const streamCRDT = tasksStorage.createStreamQuery();
 * export const getTasks = tasksStorage.createSSRQuery();
 * export const insertDocument = tasksStorage.createInsertMutation();
 * export const updateDocument = tasksStorage.createUpdateMutation();
 * export const deleteDocument = tasksStorage.createDeleteMutation();
 * ```
 */

// Main wrapper class for replicate component operations
export { Replicate } from './storage.js';

// Schema utilities
export { replicatedTable, type ReplicationFields } from './schema.js';

// Error types for server-side operations
export {
  ComponentWriteError,
  MainTableWriteError,
  VersionConflictError,
  DualStorageError,
  CRDTEncodingError,
} from './errors.js';

// Effect-based mutation functions
export { insertDocumentEffect } from './mutations/insert.js';
export { updateDocumentEffect } from './mutations/update.js';
export { deleteDocumentEffect } from './mutations/delete.js';
