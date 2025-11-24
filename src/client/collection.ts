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
import { getLogger } from './logger.js';
import { ensureSet } from './set.js';
import {
  CheckpointService,
  CheckpointServiceLive,
  YjsServiceLive,
  SubscriptionService,
  SubscriptionServiceLive,
  OptimisticService,
  OptimisticServiceLive,
  ConnectionService,
  ConnectionServiceLive,
  IDBServiceLive,
} from './services/index.js';

const logger = getLogger(['convex-replicate', 'collection']);

// Create unified services layer with proper dependency resolution
// YjsServiceLive and CheckpointServiceLive depend on IDBServiceLive
const servicesLayer = Layer.mergeAll(
  OptimisticServiceLive,
  SubscriptionServiceLive,
  ConnectionServiceLive,
  Layer.provide(YjsServiceLive, IDBServiceLive),
  Layer.provide(CheckpointServiceLive, IDBServiceLive)
);

export { OperationType } from '../component/shared.js';

const cleanupFunctions = new Map<string, () => void>();

export enum YjsOrigin {
  Insert = 'insert',
  Update = 'update',
  Remove = 'remove',

  Subscription = 'subscription',
  Snapshot = 'snapshot',
  SSRInit = 'ssr-init',
}

export type Materialized<T> = {
  documents: ReadonlyArray<T>;
  checkpoint?: { lastModified: number };
  count?: number;
  crdtBytes?: ArrayBuffer;
};

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

  metadata?: {
    schemaVersion?: number;
  };
}

export type ConvexCollection<T extends object> = Collection<T>;

export function convexCollectionOptions<T extends object>({
  getKey,
  material,
  convexClient,
  api,
  collection,
  metadata,
}: ConvexCollectionOptionsConfig<T>): CollectionConfig<T> & {
  _convexClient: ConvexClient;
  _collection: string;
} {
  const setPromise = ensureSet({
    convexClient,
    api: api.protocol ? { protocol: api.protocol } : undefined,
  });
  const clientIdKey = `convex-replicate:yjsClientId:${collection}`;
  let clientId = Number.parseInt(localStorage.getItem(clientIdKey) || '0', 10);
  if (!clientId) {
    clientId = Math.floor(Math.random() * 2147483647);
    localStorage.setItem(clientIdKey, clientId.toString());
  }

  const ydoc = new Y.Doc({ guid: collection, clientID: clientId } as any);
  const ymap = ydoc.getMap(collection);

  const persistence = new IndexeddbPersistence(collection, ydoc);

  const persistenceReadyPromise = new Promise<void>((resolve) => {
    persistence.on('synced', () => {
      resolve();
    });
  });
  let pendingUpdate: Uint8Array | null = null;
  (ydoc as any).on('updateV2', (update: Uint8Array, origin: any) => {
    if (origin === YjsOrigin.Insert || origin === YjsOrigin.Update || origin === YjsOrigin.Remove) {
      pendingUpdate = update;
    }
  });
  let syncParams: any = null;

  const reconcile = () =>
    Effect.gen(function* () {
      if (!api.material) {
        return;
      }

      const optimistic = yield* OptimisticService;

      // Wrap Convex query in Effect
      const serverResponse = yield* Effect.tryPromise({
        try: () => convexClient.query(api.material!, {}),
        catch: (error) => new Error(`Reconciliation query failed: ${error}`),
      });

      const serverDocs = Array.isArray(serverResponse)
        ? serverResponse
        : ((serverResponse as any).documents as T[] | undefined) || [];
      const serverDocIds = new Set(serverDocs.map((doc) => String(getKey(doc))));

      const toRemove: string[] = [];
      ymap.forEach((_itemYMap, key) => {
        if (!serverDocIds.has(key)) {
          toRemove.push(key);
        }
      });

      if (toRemove.length > 0) {
        const removedItems: T[] = [];
        for (const key of toRemove) {
          const itemYMap = ymap.get(key);
          if (itemYMap instanceof Y.Map) {
            removedItems.push(itemYMap.toJSON() as T);
          }
        }

        // Remove from Yjs
        ydoc.transact(() => {
          for (const key of toRemove) {
            ymap.delete(key);
          }
        }, 'reconciliation');

        // Use OptimisticService for TanStack DB!
        yield* optimistic.delete(removedItems);

        yield* Effect.logInfo('Reconciliation completed', {
          collection,
          removedCount: removedItems.length,
        });
      }
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Effect.logError('Reconciliation failed', {
            collection,
            error,
          });
        })
      )
    );

  // Helper: Apply Yjs transaction for insert operations
  const applyYjsInsert = (mutations: any[]) =>
    Effect.sync(() => {
      ydoc.transact(() => {
        mutations.forEach((mut: any) => {
          const itemYMap = new Y.Map();
          Object.entries(mut.modified as Record<string, unknown>).forEach(([k, v]) => {
            itemYMap.set(k, v);
          });
          ymap.set(String(mut.key), itemYMap);
        });
      }, YjsOrigin.Insert);
    });

  // Helper: Apply Yjs transaction for update operations
  const applyYjsUpdate = (mutations: any[]) =>
    Effect.sync(() => {
      ydoc.transact(() => {
        mutations.forEach((mut: any) => {
          const itemYMap = ymap.get(String(mut.key)) as Y.Map<any> | undefined;
          if (itemYMap) {
            const modifiedFields = mut.modified as Record<string, unknown>;
            if (!modifiedFields) {
              logger.warn('mut.modified is null/undefined', {
                collection,
                key: String(mut.key),
              });
              return;
            }
            Object.entries(modifiedFields).forEach(([k, v]) => {
              itemYMap.set(k, v);
            });
          } else {
            logger.error('Update attempted on non-existent item - skipping', {
              collection,
              key: String(mut.key),
            });
          }
        });
      }, YjsOrigin.Update);
    });

  // Helper: Apply Yjs transaction for delete operations
  const applyYjsDelete = (mutations: any[]) =>
    Effect.sync(() => {
      ydoc.transact(() => {
        mutations.forEach((mut: any) => {
          ymap.delete(String(mut.key));
        });
      }, YjsOrigin.Remove);
    });

  return {
    id: collection,
    getKey,

    // Store for extraction by createConvexCollection
    _convexClient: convexClient,
    _collection: collection,

    // REAL onInsert handler (called automatically by TanStack DB)
    onInsert: async ({ transaction }: any) => {
      try {
        await Promise.all([setPromise, persistenceReadyPromise]);

        // Update Yjs in transaction using helper
        await Effect.runPromise(applyYjsInsert(transaction.mutations));

        // Send DELTA to Convex
        if (pendingUpdate) {
          const documentKey = String(transaction.mutations[0].key);
          const mutationArgs: any = {
            documentId: documentKey,
            crdtBytes: pendingUpdate.slice().buffer,
            materializedDoc: transaction.mutations[0].modified,
            version: Date.now(),
          };

          if (metadata?.schemaVersion !== undefined) {
            mutationArgs._schemaVersion = metadata.schemaVersion;
          }

          await convexClient.mutation(api.insert, mutationArgs);
          pendingUpdate = null;
        }
      } catch (error: any) {
        logger.error('Insert failed', {
          collection,
          error: error?.message,
          status: error?.status,
        });

        // Classify errors for retry behavior
        if (error?.status === 401 || error?.status === 403) {
          throw new NonRetriableError('Authentication failed');
        }
        if (error?.status === 422) {
          throw new NonRetriableError('Validation error');
        }

        // Network errors retry automatically
        throw error;
      }
    },

    // REAL onUpdate handler (called automatically by TanStack DB)
    onUpdate: async ({ transaction }: any) => {
      try {
        // Wait for BOTH initialization AND IndexedDB persistence
        await Promise.all([setPromise, persistenceReadyPromise]);

        // Update Yjs in transaction using helper
        await Effect.runPromise(applyYjsUpdate(transaction.mutations));

        // Send delta to Convex
        if (pendingUpdate) {
          const documentKey = String(transaction.mutations[0].key);
          const itemYMap = ymap.get(documentKey) as Y.Map<any>;
          const fullDoc = itemYMap ? itemYMap.toJSON() : transaction.mutations[0].modified;

          const mutationArgs: any = {
            documentId: documentKey,
            crdtBytes: pendingUpdate.slice().buffer,
            materializedDoc: fullDoc,
            version: Date.now(),
          };

          if (metadata?.schemaVersion !== undefined) {
            mutationArgs._schemaVersion = metadata.schemaVersion;
          }

          await convexClient.mutation(api.update, mutationArgs);
          pendingUpdate = null;
        } else {
          logger.warn('pendingUpdate is null - no delta to send', {
            collection,
          });
        }
      } catch (error: any) {
        logger.error('Update failed', {
          collection,
          error: error?.message,
          status: error?.status,
        });

        // Classify errors
        if (error?.status === 401 || error?.status === 403) {
          throw new NonRetriableError('Authentication failed');
        }
        if (error?.status === 422) {
          throw new NonRetriableError('Validation error');
        }

        throw error;
      }
    },

    // onDelete handler (called when user does collection.delete())
    onDelete: async ({ transaction }: any) => {
      try {
        await Promise.all([setPromise, persistenceReadyPromise]);

        // Apply Yjs delete and sync to TanStack DB using services
        await Effect.runPromise(
          Effect.gen(function* () {
            const optimistic = yield* OptimisticService;

            // Apply Yjs delete using helper
            yield* applyYjsDelete(transaction.mutations);

            // Use OptimisticService for TanStack DB!
            const itemsToDelete = transaction.mutations.map((mut: any) => mut.original);
            yield* optimistic.delete(itemsToDelete);
          }).pipe(Effect.provide(servicesLayer))
        );

        // Send deletion DELTA to Convex (mutation handler's job)
        if (pendingUpdate) {
          const documentKey = String(transaction.mutations[0].key);
          const mutationArgs: any = {
            documentId: documentKey,
            crdtBytes: pendingUpdate.slice().buffer,
            version: Date.now(),
          };

          if (metadata?.schemaVersion !== undefined) {
            mutationArgs._schemaVersion = metadata.schemaVersion;
          }

          await convexClient.mutation(api.remove, mutationArgs);
          pendingUpdate = null;
        }
      } catch (error: any) {
        logger.error('Delete operation failed', {
          collection,
          error: error?.message,
          status: error?.status,
        });

        if (error?.status === 401 || error?.status === 403) {
          throw new NonRetriableError('Authentication failed');
        }
        if (error?.status === 422) {
          throw new NonRetriableError('Validation error');
        }

        throw error;
      }
    },

    // Sync function for pulling data from server
    sync: {
      rowUpdateMode: 'full', // We send complete documents from Yjs, not partial updates
      sync: (params: any) => {
        const { markReady } = params;

        // Clean up any existing collection instance for this collection
        // This prevents subscription leaks when collections are recreated (e.g., during HMR)
        const existingCleanup = cleanupFunctions.get(collection);
        if (existingCleanup) {
          existingCleanup();
          cleanupFunctions.delete(collection);
        }

        // Store TanStack DB sync methods for snapshot restore
        syncParams = params;

        // Initialize subscription and monitoring variables
        let subscription: (() => void) | null = null;
        let connectionMonitor: (() => void) | null = null;

        // Declare SSR variables
        let ssrDocuments: ReadonlyArray<T> | undefined;
        let ssrCheckpoint: { lastModified: number } | undefined;
        let ssrCRDTBytes: ArrayBuffer | undefined;

        // Parse SSR data if provided
        if (material) {
          ssrDocuments = material.documents;
          ssrCheckpoint = material.checkpoint;
          ssrCRDTBytes = material.crdtBytes;
        }

        // Collect initial docs for TanStack DB
        const docs: T[] = ssrDocuments ? [...ssrDocuments] : [];

        // Setup checkpoint service layer
        const checkpointLayer = Layer.provide(CheckpointServiceLive, IDBServiceLive);

        // Start async initialization + data loading + subscription
        (async () => {
          try {
            await Promise.all([setPromise, persistenceReadyPromise]);

            // Initialize OptimisticService with syncParams
            await Effect.runPromise(
              Effect.gen(function* () {
                const optimistic = yield* OptimisticService;
                yield* optimistic.initialize(params);
              }).pipe(Effect.provide(servicesLayer))
            );
            if (ssrCRDTBytes) {
              // Apply CRDT bytes to Yjs (preserves original Item IDs)
              Y.applyUpdateV2(ydoc, new Uint8Array(ssrCRDTBytes), YjsOrigin.SSRInit);

              // Save checkpoint so subscription starts from correct point
              if (ssrCheckpoint) {
                await Effect.runPromise(
                  Effect.gen(function* () {
                    const checkpointService = yield* CheckpointService;
                    yield* checkpointService.saveCheckpoint(collection, ssrCheckpoint);
                  }).pipe(Effect.provide(checkpointLayer))
                );
              }
            }
            if (ssrDocuments && ssrDocuments.length > 0) {
              ydoc.transact(() => {
                for (const item of ssrDocuments) {
                  const key = String(getKey(item));

                  // Get existing Y.Map or create new one
                  let itemYMap = ymap.get(key) as Y.Map<unknown> | undefined;
                  if (!itemYMap) {
                    itemYMap = new Y.Map();
                    ymap.set(key, itemYMap);
                  }

                  // CRDT merge: Update all fields from SSR data
                  Object.entries(item as Record<string, unknown>).forEach(([k, v]) => {
                    itemYMap.set(k, v);
                  });
                }
              }, YjsOrigin.SSRInit);
            }

            if (ymap.size > 0) {
              const { begin, write, commit } = syncParams;
              begin();

              ymap.forEach((itemYMap, _key) => {
                if (itemYMap instanceof Y.Map) {
                  const item = itemYMap.toJSON() as T;
                  // Use insert for initial sync to populate TanStack DB
                  // If item already exists (shouldn't happen), try/catch will handle it
                  try {
                    write({ type: 'insert', value: item });
                  } catch {
                    // Fallback to update if item somehow already exists
                    write({ type: 'update', value: item });
                  }
                }
              });

              commit();
            }

            await Effect.runPromise(reconcile().pipe(Effect.provide(servicesLayer)));

            // Load checkpoint
            // If we have SSR data (docs.length > 0), start from checkpoint 0
            // Otherwise, use stored checkpoint to resume from where we left off
            const checkpoint = await Effect.runPromise(
              Effect.gen(function* () {
                const checkpointService = yield* CheckpointService;
                return yield* checkpointService.loadCheckpointWithStaleDetection(
                  collection,
                  docs.length > 0
                );
              }).pipe(Effect.provide(checkpointLayer))
            );

            // Define subscription handler as Effect program
            const subscriptionHandler = (response: any) =>
              Effect.gen(function* () {
                const optimistic = yield* OptimisticService;
                const checkpointSvc = yield* CheckpointService;

                const { changes, checkpoint: newCheckpoint } = response;

                for (const change of changes) {
                  const { operationType, crdtBytes, documentId } = change;

                  if (operationType === 'snapshot') {
                    // Apply snapshot to Yjs
                    Y.applyUpdateV2(ydoc, new Uint8Array(crdtBytes), YjsOrigin.Snapshot);

                    // Replace all data in TanStack DB
                    const items: T[] = [];
                    ymap.forEach((itemYMap) => {
                      if (itemYMap instanceof Y.Map) {
                        items.push(itemYMap.toJSON() as T);
                      }
                    });
                    yield* optimistic.replaceAll(items);
                  } else {
                    // Capture item data BEFORE applying delta
                    let itemBeforeDelta: T | null = null;
                    if (documentId) {
                      const itemYMapBefore = ymap.get(documentId);
                      if (itemYMapBefore instanceof Y.Map) {
                        itemBeforeDelta = itemYMapBefore.toJSON() as T;
                      }
                    }

                    // Apply delta to Yjs
                    Y.applyUpdateV2(ydoc, new Uint8Array(crdtBytes), YjsOrigin.Subscription);

                    // Sync affected document to TanStack DB
                    if (documentId) {
                      const itemYMap = ymap.get(documentId);
                      if (itemYMap instanceof Y.Map) {
                        // Item EXISTS after delta - upsert
                        const item = itemYMap.toJSON() as T;
                        yield* optimistic.upsert([item]);
                      } else if (itemBeforeDelta) {
                        // Item DELETED by delta
                        yield* optimistic.delete([itemBeforeDelta]);
                      }
                    }
                  }
                }

                // Save checkpoint
                yield* checkpointSvc.saveCheckpoint(collection, newCheckpoint);
              }).pipe(Effect.provide(servicesLayer));

            // Initialize SubscriptionService and create subscription
            subscription = await Effect.runPromise(
              Effect.gen(function* () {
                const subscriptionSvc = yield* SubscriptionService;

                // Initialize subscription service
                yield* subscriptionSvc.initialize({
                  convexClient,
                  api: api.stream,
                  collection,
                });

                // Create subscription with handler
                return yield* subscriptionSvc.create(checkpoint, subscriptionHandler);
              }).pipe(Effect.provide(servicesLayer))
            );

            // Setup reconnection handling with ConnectionService
            connectionMonitor = await Effect.runPromise(
              Effect.gen(function* () {
                const connectionSvc = yield* ConnectionService;
                const subscriptionSvc = yield* SubscriptionService;
                const checkpointSvc = yield* CheckpointService;

                return yield* connectionSvc.startMonitoring({
                  onOnline: () =>
                    Effect.gen(function* () {
                      yield* Effect.logInfo('Connection restored, recreating subscription', {
                        collection,
                      });

                      // Load latest checkpoint
                      const latestCheckpoint = yield* checkpointSvc.loadCheckpoint(collection);

                      // Recreate subscription with latest checkpoint - ONE LINE!
                      yield* subscriptionSvc.recreate(latestCheckpoint);

                      yield* Effect.logInfo('Subscription recreated successfully', {
                        collection,
                      });
                    }),
                });
              }).pipe(Effect.provide(servicesLayer))
            );

            // Mark collection as ready
            markReady();
          } catch (error) {
            logger.error('Failed to set up collection', { error, collection });
            markReady(); // Mark ready anyway to avoid blocking
          }
        })();

        // Return initial data and cleanup function
        return {
          material: docs,
          cleanup: () => {
            // Cleanup subscription
            if (subscription) {
              subscription();
            }

            // Cleanup connection monitor
            if (connectionMonitor) {
              connectionMonitor();
            }

            persistence.destroy();
            cleanupFunctions.delete(collection);
          },
        };
      },
    },
  };
}

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
