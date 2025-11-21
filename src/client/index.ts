export {
  setReplicate,
  getProtocolInfo,
  resetProtocolStorage,
  type SetOptions,
} from './set.js';

export {
  getStoredProtocolVersion,
  storeProtocolVersion,
  migrateLocalStorage,
  clearProtocolStorage,
  getProtocolMetadata,
} from './protocol.js';

export {
  convexCollectionOptions,
  handleReconnect,
  type ConvexCollection,
  type ConvexCollectionOptionsConfig,
  type Materialized,
} from './collection.js';

export * as Y from 'yjs';
export { IndexeddbPersistence } from 'y-indexeddb';

export { OperationType } from '../component/shared.js';

export { NonRetriableError } from '@tanstack/offline-transactions';
