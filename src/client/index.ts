export { setReplicate, getProtocolInfo, type SetOptions } from '$/client/set.js';

export {
  convexCollectionOptions,
  handleReconnect,
  type ConvexCollection,
  type ConvexCollectionOptionsConfig,
  type Materialized,
} from '$/client/collection.js';

export * as Y from 'yjs';
export { IndexeddbPersistence } from 'y-indexeddb';

export { OperationType } from '$/component/shared.js';

export { NonRetriableError } from '@tanstack/offline-transactions';
