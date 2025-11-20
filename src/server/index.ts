/**
 * Server-side utilities for Convex backend.
 * Import this in your Convex functions (convex/*.ts files).
 *
 * @example
 * ```typescript
 * // convex/tasks.ts
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
 */

// One-step API builder
export { defineReplicate } from './builder.js';

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
