import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  startOfflineExecutor,
  NonRetriableError,
  type OfflineExecutor,
} from '@tanstack/offline-transactions';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import type { CollectionConfig, Collection } from '@tanstack/db';
import { Effect, Layer } from 'effect';
import { getLogger } from '$/client/logger.js';
import { ensureSet } from '$/client/set.js';
import { Checkpoint, CheckpointLive } from '$/client/services/checkpoint.js';
import { Reconciliation, ReconciliationLive } from '$/client/services/reconciliation.js';
import { SnapshotLive } from '$/client/services/snapshot.js';
import {
  initializeReplicateParams,
  replicateInsert,
  replicateDelete,
  replicateUpsert,
  replicateReplace,
} from '$/client/replicate.js';
import {
  createYjsDocument,
  getYMap,
  transactWithDelta,
  applyUpdate,
  extractItems,
  extractItem,
} from '$/client/merge.js';

const logger = getLogger(['replicate', 'collection']);

interface HttpError extends Error {
  status?: number;
}

/** Mutation data passed by TanStack DB transaction handlers */
interface CollectionMutation<T> {
  key: string | number;
  modified: T;
  original?: T | Record<string, never>;
  changes?: Partial<T>;
}

/** Transaction wrapper containing mutations array */
interface CollectionTransaction<T> {
  transaction: { mutations: CollectionMutation<T>[] };
}

function handleMutationError(
  error: unknown,
  operation: 'Insert' | 'Update' | 'Delete',
  collection: string
): never {
  const httpError = error as HttpError;
  logger.error(`${operation} failed`, {
    collection,
    error: httpError?.message,
    status: httpError?.status,
  });

  if (httpError?.status === 401 || httpError?.status === 403) {
    throw new NonRetriableError('Authentication failed');
  }
  if (httpError?.status === 422) {
    throw new NonRetriableError('Validation error');
  }
  throw error;
}

const servicesLayer = Layer.mergeAll(
  CheckpointLive,
  ReconciliationLive,
  Layer.provide(SnapshotLive, CheckpointLive)
);

export { OperationType } from '$/component/shared.js';

const cleanupFunctions = new Map<string, () => void>();

/** Origin markers for Yjs transactions - used for undo tracking and debugging */
export enum YjsOrigin {
  Insert = 'insert',
  Update = 'update',
  Remove = 'remove',

  Subscription = 'subscription',
  Snapshot = 'snapshot',
  SSRInit = 'ssr-init',
}

/** Server-rendered material data for SSR hydration */
export type Materialized<T> = {
  documents: ReadonlyArray<T>;
  checkpoint?: { lastModified: number };
  count?: number;
  crdtBytes?: ArrayBuffer;
};

/** Configuration for creating a Convex-backed collection */
export interface ConvexCollectionOptionsConfig<T extends object> {
  getKey: (item: T) => string | number;
  material?: Materialized<T>;
  convexClient: ConvexClient;
  api: {
    stream: FunctionReference<'query'>;
    insert: FunctionReference<'mutation'>;
    update: FunctionReference<'mutation'>;
    remove: FunctionReference<'mutation'>;
    protocol?: FunctionReference<'query'>;
    material?: FunctionReference<'query'>;
    [key: string]: any;
  };
  collection: string;
  /** Undo capture timeout in ms. Changes within this window merge into one undo. Default: 500 */
  undoCaptureTimeout?: number;
  /** Origins to track for undo. Default: insert, update, remove */
  undoTrackedOrigins?: Set<any>;
}

/** Undo/Redo manager for a collection */
export interface UndoManager {
  /** Undo the last change */
  undo: () => void;
  /** Redo the last undone change */
  redo: () => void;
  /** Check if undo is available */
  canUndo: () => boolean;
  /** Check if redo is available */
  canRedo: () => boolean;
  /** Clear undo/redo history */
  clearHistory: () => void;
  /** Stop capturing - force the next change to create a new undo stack item */
  stopCapturing: () => void;
}

export type ConvexCollection<T extends object> = Collection<T>;

// Module-level storage for undo managers (accessed by getUndoManager)
const undoManagers = new Map<string, UndoManager>();

/**
 * Get the UndoManager for a collection.
 * Must be called after the collection's sync function has initialized.
 *
 * @param collectionName - The collection name
 * @returns UndoManager or null if not yet initialized
 */
export function getUndoManager(collectionName: string): UndoManager | null {
  return undoManagers.get(collectionName) ?? null;
}

/**
 * Create TanStack DB collection options with Convex + Yjs replication.
 *
 * @example
 * ```typescript
 * const options = convexCollectionOptions<Task>({
 *   getKey: (t) => t.id,
 *   convexClient,
 *   api: { stream: api.tasks.stream, insert: api.tasks.insert, ... },
 *   collection: 'tasks',
 * });
 * const collection = createCollection(options);
 * ```
 */
export function convexCollectionOptions<T extends object>({
  getKey,
  material,
  convexClient,
  api,
  collection,
  undoCaptureTimeout = 500,
  undoTrackedOrigins,
}: ConvexCollectionOptionsConfig<T>): CollectionConfig<T> & {
  _convexClient: ConvexClient;
  _collection: string;
} {
  const setPromise = ensureSet({
    convexClient,
    api: api.protocol ? { protocol: api.protocol } : undefined,
  });

  let ydoc: Y.Doc = null as any;
  let ymap: Y.Map<unknown> = null as any;
  let persistence: IndexeddbPersistence = null as any;

  let resolvePersistenceReady: (() => void) | undefined;
  const persistenceReadyPromise = new Promise<void>((resolve) => {
    resolvePersistenceReady = resolve;
  });

  let resolveOptimisticReady: (() => void) | undefined;
  const optimisticReadyPromise = new Promise<void>((resolve) => {
    resolveOptimisticReady = resolve;
  });

  const reconcile = () =>
    Effect.gen(function* () {
      if (!api.material) return;

      const materialApi = api.material;
      const reconciliation = yield* Reconciliation;

      const serverResponse = yield* Effect.tryPromise({
        try: () => convexClient.query(materialApi, {}),
        catch: (error) => new Error(`Reconciliation query failed: ${error}`),
      });

      const serverDocs = Array.isArray(serverResponse)
        ? serverResponse
        : ((serverResponse as any).documents as T[] | undefined) || [];

      const removedItems = yield* reconciliation.reconcile(
        ydoc,
        ymap,
        collection,
        serverDocs,
        (doc: T) => String(getKey(doc))
      );

      if (removedItems.length > 0) {
        replicateDelete(removedItems);
      }
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Effect.logError('Reconciliation failed', { collection, error });
        })
      )
    );

  const applyYjsInsert = (mutations: CollectionMutation<T>[]): Uint8Array => {
    const { delta } = transactWithDelta(
      ydoc,
      () => {
        mutations.forEach((mut) => {
          const itemYMap = new Y.Map();
          Object.entries(mut.modified as Record<string, unknown>).forEach(([k, v]) => {
            itemYMap.set(k, v);
          });
          ymap.set(String(mut.key), itemYMap);
        });
      },
      YjsOrigin.Insert
    );
    return delta;
  };

  const applyYjsUpdate = (mutations: CollectionMutation<T>[]): Uint8Array => {
    const { delta } = transactWithDelta(
      ydoc,
      () => {
        mutations.forEach((mut) => {
          const itemYMap = ymap.get(String(mut.key)) as Y.Map<unknown> | undefined;
          if (itemYMap) {
            const modifiedFields = mut.modified as Record<string, unknown>;
            if (!modifiedFields) {
              logger.warn('mut.modified is null/undefined', { collection, key: String(mut.key) });
              return;
            }
            Object.entries(modifiedFields).forEach(([k, v]) => {
              itemYMap.set(k, v);
            });
          } else {
            logger.error('Update attempted on non-existent item', {
              collection,
              key: String(mut.key),
            });
          }
        });
      },
      YjsOrigin.Update
    );
    return delta;
  };

  const applyYjsDelete = (mutations: CollectionMutation<T>[]): Uint8Array => {
    const { delta } = transactWithDelta(
      ydoc,
      () => {
        mutations.forEach((mut) => {
          ymap.delete(String(mut.key));
        });
      },
      YjsOrigin.Remove
    );
    return delta;
  };

  return {
    id: collection,
    getKey,
    _convexClient: convexClient,
    _collection: collection,

    onInsert: async ({ transaction }: CollectionTransaction<T>) => {
      try {
        await Promise.all([setPromise, persistenceReadyPromise, optimisticReadyPromise]);
        const delta = applyYjsInsert(transaction.mutations);
        if (delta.length > 0) {
          const documentKey = String(transaction.mutations[0].key);
          await convexClient.mutation(api.insert, {
            documentId: documentKey,
            crdtBytes: delta.slice().buffer,
            materializedDoc: transaction.mutations[0].modified,
            version: Date.now(),
          });
        }
      } catch (error) {
        handleMutationError(error, 'Insert', collection);
      }
    },

    onUpdate: async ({ transaction }: CollectionTransaction<T>) => {
      try {
        await Promise.all([setPromise, persistenceReadyPromise, optimisticReadyPromise]);
        const delta = applyYjsUpdate(transaction.mutations);
        if (delta.length > 0) {
          const documentKey = String(transaction.mutations[0].key);
          const itemYMap = ymap.get(documentKey) as Y.Map<unknown>;
          const fullDoc = itemYMap ? itemYMap.toJSON() : transaction.mutations[0].modified;
          await convexClient.mutation(api.update, {
            documentId: documentKey,
            crdtBytes: delta.slice().buffer,
            materializedDoc: fullDoc,
            version: Date.now(),
          });
        }
      } catch (error) {
        handleMutationError(error, 'Update', collection);
      }
    },

    onDelete: async ({ transaction }: CollectionTransaction<T>) => {
      try {
        await Promise.all([setPromise, persistenceReadyPromise, optimisticReadyPromise]);
        const delta = applyYjsDelete(transaction.mutations);
        const itemsToDelete = transaction.mutations
          .map((mut) => mut.original)
          .filter((item): item is T => item !== undefined && Object.keys(item).length > 0);
        replicateDelete(itemsToDelete);
        if (delta.length > 0) {
          const documentKey = String(transaction.mutations[0].key);
          await convexClient.mutation(api.remove, {
            documentId: documentKey,
            crdtBytes: delta.slice().buffer,
            version: Date.now(),
          });
        }
      } catch (error) {
        handleMutationError(error, 'Delete', collection);
      }
    },

    sync: {
      rowUpdateMode: 'partial',
      sync: (params: any) => {
        const { markReady } = params;

        const existingCleanup = cleanupFunctions.get(collection);
        if (existingCleanup) {
          existingCleanup();
          cleanupFunctions.delete(collection);
        }

        let subscription: (() => void) | null = null;
        const ssrDocuments = material?.documents;
        const ssrCheckpoint = material?.checkpoint;
        const ssrCRDTBytes = material?.crdtBytes;
        const docs: T[] = ssrDocuments ? [...ssrDocuments] : [];

        (async () => {
          try {
            await setPromise;

            ydoc = await createYjsDocument(collection);
            ymap = getYMap<unknown>(ydoc, collection);

            const trackedOrigins =
              undoTrackedOrigins ?? new Set([YjsOrigin.Insert, YjsOrigin.Update, YjsOrigin.Remove]);
            const yUndoManager = new Y.UndoManager(ymap, {
              captureTimeout: undoCaptureTimeout,
              trackedOrigins,
            });

            const undoManager: UndoManager = {
              undo: () => yUndoManager.undo(),
              redo: () => yUndoManager.redo(),
              canUndo: () => yUndoManager.canUndo(),
              canRedo: () => yUndoManager.canRedo(),
              clearHistory: () => yUndoManager.clear(),
              stopCapturing: () => yUndoManager.stopCapturing(),
            };
            undoManagers.set(collection, undoManager);

            persistence = new IndexeddbPersistence(collection, ydoc);
            persistence.on('synced', () => resolvePersistenceReady?.());
            await persistenceReadyPromise;

            initializeReplicateParams(params);
            resolveOptimisticReady?.();

            if (ssrCRDTBytes) {
              applyUpdate(ydoc, new Uint8Array(ssrCRDTBytes), YjsOrigin.SSRInit);
            }

            if (ymap.size > 0) {
              const items = extractItems<T>(ymap);
              replicateInsert(items);
              logger.info('Initial sync completed', { collection, itemCount: items.length });
            }

            await Effect.runPromise(reconcile().pipe(Effect.provide(servicesLayer)));

            const checkpoint =
              ssrCheckpoint ||
              (await Effect.runPromise(
                Effect.gen(function* () {
                  const checkpointSvc = yield* Checkpoint;
                  return yield* checkpointSvc.loadCheckpoint(collection);
                }).pipe(Effect.provide(CheckpointLive))
              ));

            const handleSnapshotChange = (crdtBytes: ArrayBuffer) => {
              applyUpdate(ydoc, new Uint8Array(crdtBytes), YjsOrigin.Snapshot);
              replicateReplace(extractItems<T>(ymap));
            };

            const handleDeltaChange = (crdtBytes: ArrayBuffer, documentId: string | undefined) => {
              const itemBefore = documentId ? extractItem<T>(ymap, documentId) : null;
              applyUpdate(ydoc, new Uint8Array(crdtBytes), YjsOrigin.Subscription);

              if (!documentId) return;

              const itemAfter = extractItem<T>(ymap, documentId);
              if (itemAfter) {
                replicateUpsert([itemAfter]);
              } else if (itemBefore) {
                replicateDelete([itemBefore]);
              }
            };

            const subscriptionHandler = (response: any) =>
              Effect.gen(function* () {
                const checkpointSvc = yield* Checkpoint;
                const { changes, checkpoint: newCheckpoint } = response;

                for (const change of changes) {
                  const { operationType, crdtBytes, documentId } = change;
                  if (operationType === 'snapshot') {
                    handleSnapshotChange(crdtBytes);
                  } else {
                    handleDeltaChange(crdtBytes, documentId);
                  }
                }

                yield* checkpointSvc.saveCheckpoint(collection, newCheckpoint);
              }).pipe(Effect.provide(servicesLayer));

            subscription = convexClient.onUpdate(
              api.stream,
              { checkpoint, limit: 1000 },
              (response: any) => {
                Effect.runPromise(
                  subscriptionHandler(response).pipe(
                    Effect.catchAllCause((cause) =>
                      Effect.logError('Subscription handler error', { cause })
                    )
                  )
                );
              }
            );

            markReady();
          } catch (error) {
            logger.error('Failed to set up collection', { error, collection });
            markReady();
          }
        })();

        return {
          material: docs,
          cleanup: () => {
            subscription?.();
            undoManagers.delete(collection);
            persistence?.destroy();
            ydoc?.destroy();
            cleanupFunctions.delete(collection);
          },
        };
      },
    },
  };
}

/**
 * Wrap a collection with offline transaction handling and reconnection logic.
 * Must be called after createCollection to enable offline-first behavior.
 *
 * @example
 * ```typescript
 * const rawCollection = createCollection(convexCollectionOptions<Task>({ ... }));
 * const collection = handleReconnect(rawCollection);
 * ```
 */
export function handleReconnect<T extends object>(
  rawCollection: Collection<T>
): ConvexCollection<T> {
  // Extract config from rawCollection
  const config = (rawCollection as any).config;
  const convexClient = config._convexClient;
  const collection = config._collection;

  if (!convexClient || !collection) {
    throw new Error(
      'handleReconnect requires a collection created with convexCollectionOptions. ' +
        'Make sure you pass convexClient and collection to convexCollectionOptions.'
    );
  }

  const offline: OfflineExecutor = startOfflineExecutor({
    collections: { [collection]: rawCollection as any },
    mutationFns: {},

    beforeRetry: (transactions) => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
      const filtered = transactions.filter((tx) => {
        const isRecent = tx.createdAt.getTime() > cutoff;
        const notExhausted = tx.retryCount < 10;
        return isRecent && notExhausted;
      });

      if (filtered.length < transactions.length) {
        logger.warn('Filtered stale transactions', {
          collection,
          before: transactions.length,
          after: filtered.length,
        });
      }

      return filtered;
    },

    onLeadershipChange: (_) => {
      // Leadership changed
    },

    onStorageFailure: (diagnostic) => {
      logger.warn('Storage failed - online-only mode', {
        collection,
        code: diagnostic.code,
        message: diagnostic.message,
      });
    },
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      offline.notifyOnline();
    });
  }
  return rawCollection as ConvexCollection<T>;
}
