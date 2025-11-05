/**
 * Server-side utilities for Convex backend.
 * Import this in your Convex functions (convex/*.ts files).
 *
 * @example
 * ```typescript
 * // convex/tasks.ts
 * import {
 *   insertDocumentHelper,
 *   updateDocumentHelper,
 *   deleteDocumentHelper,
 *   streamHelper,
 * } from '@trestleinc/replicate/server';
 * ```
 */

// Replication helpers for mutations/queries
export {
  insertDocumentHelper,
  updateDocumentHelper,
  deleteDocumentHelper,
  streamHelper,
} from './replication.js';

// Schema utilities
export { replicatedTable, type ReplicationFields } from './schema.js';
