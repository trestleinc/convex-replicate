/**
 * Client-side utilities for browser/React code.
 * Import this in your frontend components.
 *
 * @example
 * ```typescript
 * // src/useTasks.ts
 * import {
 *   convexCollectionOptions,
 *   handleReconnect,
 *   type ConvexCollection,
 * } from '@trestleinc/replicate/client';
 * ```
 */

// Protocol initialization and migration
export {
  initConvexReplicate,
  getProtocolInfo,
  resetProtocolStorage,
  type InitOptions,
} from './init.js';

// Protocol migration utilities (advanced usage)
export {
  getStoredProtocolVersion,
  storeProtocolVersion,
  migrateLocalStorage,
  clearProtocolStorage,
  getProtocolMetadata,
} from './protocol.js';

// TanStack DB collection integration
export {
  convexCollectionOptions,
  handleReconnect,
  type ConvexCollection,
  type ConvexCollectionOptionsConfig,
} from './collection.js';

// Re-export Yjs and IndexedDB persistence for advanced usage
export * as Y from 'yjs';
export { IndexeddbPersistence } from 'y-indexeddb';

// Re-export shared types
export { OperationType } from '../component/shared.js';

// Re-export TanStack DB offline utilities
export { NonRetriableError } from '@tanstack/offline-transactions';
