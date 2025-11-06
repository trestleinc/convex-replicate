/**
 * Client-side utilities for browser/React code.
 * Import this in your frontend components.
 *
 * @example
 * ```typescript
 * // src/useTasks.ts
 * import {
 *   convexCollectionOptions,
 *   createConvexCollection,
 *   type ConvexCollection,
 * } from '@trestleinc/replicate/client';
 * ```
 */

// Component client (ReplicateStorage class)
export { ReplicateStorage } from './storage.js';

// TanStack DB collection integration
export {
  convexCollectionOptions,
  createConvexCollection,
  type ConvexCollection,
  type ConvexCollectionOptionsConfig,
} from './collection.js';

// Protocol Evolution (initialization & version management)
export { initializeConvexReplicate, CLIENT_PROTOCOL_VERSION } from './init.js';
export {
  getStoredProtocolVersion,
  storeProtocolVersion,
  migrateLocalStorage,
} from './protocol-migration.js';

// Re-export Yjs for convenience
export * as Y from 'yjs';

// Re-export TanStack DB offline utilities
export { NonRetriableError } from '@tanstack/offline-transactions';
