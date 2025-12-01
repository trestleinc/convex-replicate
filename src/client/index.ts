export { setReplicate, getProtocolInfo, type SetOptions } from '$/client/set.js';

export {
  convexCollectionOptions,
  handleReconnect,
  getUndoManager,
  YjsOrigin,
  type ConvexCollection,
  type ConvexCollectionOptionsConfig,
  type Materialized,
  type UndoManager,
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

export { NonRetriableError } from '@tanstack/offline-transactions';

export * as history from '$/client/history.js';
export type { Diff, Fields } from '$/client/history.js';
