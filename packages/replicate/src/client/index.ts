// Main exports - unified client API for @trestleinc/replicate

// Component client (ReplicateStorage class)
export { ReplicateStorage } from './storage.js';

// TanStack DB collection integration
export {
  convexCollectionOptions,
  createConvexCollection,
  type ConvexCollection,
  type ConvexCollectionOptionsConfig,
} from './collection.js';

// Logger utilities
export { configureLogger, getLogger } from './logger.js';

// Re-export Yjs for convenience
export * as Y from 'yjs';

// Re-export TanStack DB offline utilities
export { NonRetriableError } from '@tanstack/offline-transactions';
