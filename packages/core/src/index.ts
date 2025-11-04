// Main exports - two-step collection creation with offline support
export {
  convexCollectionOptions,
  createConvexCollection,
  type ConvexCollectionOptionsConfig,
  type ConvexCollection,
} from './collection.js';

// Logger utilities
export { configureLogger, getLogger } from './logger.js';

// Re-export Yjs for convenience
export * as Y from 'yjs';

// Re-export TanStack DB offline utilities
export { NonRetriableError } from '@tanstack/offline-transactions';

// SSR utilities
export { loadCollection, type CollectionAPI, type LoadCollectionConfig } from './ssr.js';

// Replication helpers (server-safe - no Yjs imports!)
export {
  insertDocumentHelper,
  updateDocumentHelper,
  deleteDocumentHelper,
  pullChangesHelper,
  changeStreamHelper,
} from './replication.js';
