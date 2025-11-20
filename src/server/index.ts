/**
 * Server-side utilities for Convex backend.
 * Import this in your Convex functions (convex/*.ts files).
 *
 * @example
 * ```typescript
 * // convex/tasks.ts - One-step API generation (recommended)
 * import { defineReplicate } from '@trestleinc/replicate/server';
 * import { components } from './_generated/api';
 * import type { Task } from '../src/useTasks';
 *
 * export const {
 *   stream,
 *   getTasks,
 *   insertDocument,
 *   updateDocument,
 *   deleteDocument,
 *   getProtocolVersion,
 *   compact,
 *   prune
 * } = defineReplicate<Task>({
 *   component: components.replicate,
 *   collection: 'tasks'
 * });
 * ```
 *
 * Or use the Replicate class directly (advanced):
 * ```typescript
 * import { Replicate } from '@trestleinc/replicate/server';
 * import { components } from './_generated/api';
 * import type { Task } from '../src/useTasks';
 *
 * const tasksStorage = new Replicate<Task>(components.replicate, 'tasks');
 *
 * export const stream = tasksStorage.createStreamQuery();
 * export const getTasks = tasksStorage.createSSRQuery();
 * export const insertDocument = tasksStorage.createInsertMutation();
 * export const updateDocument = tasksStorage.createUpdateMutation();
 * export const deleteDocument = tasksStorage.createDeleteMutation();
 * ```
 */

// One-step API builder (recommended)
export { defineReplicate } from './builder.js';

// Main wrapper class for replicate component operations (advanced usage)
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

// Effect-based mutation functions (internal, exported for advanced usage)
export { insertDocumentEffect } from './mutations/insert.js';
export { updateDocumentEffect } from './mutations/update.js';
export { deleteDocumentEffect } from './mutations/delete.js';
