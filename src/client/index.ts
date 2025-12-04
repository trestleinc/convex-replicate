export { setReplicate, getProtocolInfo, type SetOptions } from '$/client/set.js';

export {
  convexCollectionOptions,
  handleReconnect,
  getYDoc,
  YjsOrigin,
  type ConvexCollection,
  type ConvexCollectionOptionsConfig,
  type Materialized,
} from '$/client/collection.js';

export {
  NetworkError,
  IDBError,
  IDBWriteError,
  ReconciliationError,
} from '$/client/errors.js';

export * as Y from 'yjs';
export { IndexeddbPersistence } from 'y-indexeddb';

export { OperationType } from '$/component/shared.js';

export {
  fragment,
  extractItemWithFragments,
  extractItemsWithFragments,
  type FragmentValue,
  type XmlFragmentJSON,
  type XmlNodeJSON,
} from '$/client/merge.js';

export { NonRetriableError } from '@tanstack/offline-transactions';
