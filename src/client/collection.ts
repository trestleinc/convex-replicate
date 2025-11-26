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
import { createYjsDocument, getYMap, transactWithDelta, applyUpdate } from '$/client/merge.js';

const logger = getLogger(['replicate', 'collection']);

// Create unified services layer
// Services now use plain functions directly - simplified dependency chain
const servicesLayer = Layer.mergeAll(
  CheckpointLive,
  ReconciliationLive,
  Layer.provide(SnapshotLive, CheckpointLive)
);

export { OperationType } from '$/component/shared.js';

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

  // Declare Yjs variables - will be initialized in sync function using YjsService
  let ydoc: Y.Doc = null as any; // Initialized before mutation handlers can be called
  let ymap: Y.Map<unknown> = null as any;
  let persistence: IndexeddbPersistence = null as any;

  // Create deferred promises immediately - never null to avoid race conditions
  // These are resolved by the sync function after initialization completes
  let resolvePersistenceReady: (() => void) | undefined;
  const persistenceReadyPromise = new Promise<void>((resolve) => {
    resolvePersistenceReady = resolve;
  });

  let resolveOptimisticReady: (() => void) | undefined;
  const optimisticReadyPromise = new Promise<void>((resolve) => {
    resolveOptimisticReady = resolve;
  });

  // Reconciliation function that uses ReconciliationService
  const reconcile = () =>
    Effect.gen(function* () {
      if (!api.material) {
        return;
      }

      const materialApi = api.material;
      const reconciliation = yield* Reconciliation;

      // Wrap Convex query in Effect
      const serverResponse = yield* Effect.tryPromise({
        try: () => convexClient.query(materialApi, {}),
        catch: (error) => new Error(`Reconciliation query failed: ${error}`),
      });

      const serverDocs = Array.isArray(serverResponse)
        ? serverResponse
        : ((serverResponse as any).documents as T[] | undefined) || [];

      // Use ReconciliationService to handle phantom document removal
      const removedItems = yield* reconciliation.reconcile(
        ydoc,
        ymap,
        collection,
        serverDocs,
        (doc: T) => String(getKey(doc))
      );

      // Sync deletions to TanStack DB via plain function
      if (removedItems.length > 0) {
        replicateDelete(removedItems);
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

  // Helper: Apply Yjs transaction for insert operations and return delta
  const applyYjsInsert = (mutations: any[]): Uint8Array => {
    const { delta } = transactWithDelta(
      ydoc,
      () => {
        mutations.forEach((mut: any) => {
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

  // Helper: Apply Yjs transaction for update operations and return delta
  const applyYjsUpdate = (mutations: any[]): Uint8Array => {
    const { delta } = transactWithDelta(
      ydoc,
      () => {
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
      },
      YjsOrigin.Update
    );
    return delta;
  };

  // Helper: Apply Yjs transaction for delete operations and return delta
  const applyYjsDelete = (mutations: any[]): Uint8Array => {
    const { delta } = transactWithDelta(
      ydoc,
      () => {
        mutations.forEach((mut: any) => {
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

    // Store for extraction by createConvexCollection
    _convexClient: convexClient,
    _collection: collection,

    // REAL onInsert handler (called automatically by TanStack DB)
    onInsert: async ({ transaction }: any) => {
      try {
        await Promise.all([setPromise, persistenceReadyPromise, optimisticReadyPromise]);

        // Update Yjs and get delta inline - plain function, no Effect needed
        const delta = applyYjsInsert(transaction.mutations);

        // Send DELTA to Convex
        if (delta.length > 0) {
          const documentKey = String(transaction.mutations[0].key);
          const mutationArgs: any = {
            documentId: documentKey,
            crdtBytes: delta.slice().buffer,
            materializedDoc: transaction.mutations[0].modified,
            version: Date.now(),
          };

          if (metadata?.schemaVersion !== undefined) {
            mutationArgs._schemaVersion = metadata.schemaVersion;
          }

          await convexClient.mutation(api.insert, mutationArgs);
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
        await Promise.all([setPromise, persistenceReadyPromise, optimisticReadyPromise]);

        // Update Yjs and get delta inline - plain function, no Effect needed
        const delta = applyYjsUpdate(transaction.mutations);

        // Send delta to Convex
        if (delta.length > 0) {
          const documentKey = String(transaction.mutations[0].key);
          const itemYMap = ymap.get(documentKey) as Y.Map<any>;
          const fullDoc = itemYMap ? itemYMap.toJSON() : transaction.mutations[0].modified;

          const mutationArgs: any = {
            documentId: documentKey,
            crdtBytes: delta.slice().buffer,
            materializedDoc: fullDoc,
            version: Date.now(),
          };

          if (metadata?.schemaVersion !== undefined) {
            mutationArgs._schemaVersion = metadata.schemaVersion;
          }

          await convexClient.mutation(api.update, mutationArgs);
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
        await Promise.all([setPromise, persistenceReadyPromise, optimisticReadyPromise]);

        // Apply Yjs delete and get delta inline - plain function, no Effect needed
        const delta = applyYjsDelete(transaction.mutations);

        // Sync to TanStack DB using plain function
        const itemsToDelete = transaction.mutations.map((mut: any) => mut.original);
        replicateDelete(itemsToDelete);

        // Send deletion DELTA to Convex
        if (delta.length > 0) {
          const documentKey = String(transaction.mutations[0].key);
          const mutationArgs: any = {
            documentId: documentKey,
            crdtBytes: delta.slice().buffer,
            version: Date.now(),
          };

          if (metadata?.schemaVersion !== undefined) {
            mutationArgs._schemaVersion = metadata.schemaVersion;
          }

          await convexClient.mutation(api.remove, mutationArgs);
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

        // TanStack DB sync methods stored in module-level syncParams

        // Initialize subscription variable
        let subscription: (() => void) | null = null;

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

        // Start async initialization + data loading + subscription
        (async () => {
          try {
            await setPromise; // Wait for protocol initialization

            // Create Yjs document using plain function
            ydoc = await createYjsDocument(collection);
            ymap = getYMap<unknown>(ydoc, collection);

            // Setup persistence (imperative - y-indexeddb constraint)
            // Resolve the deferred promise when persistence syncs
            persistence = new IndexeddbPersistence(collection, ydoc);
            persistence.on('synced', () => resolvePersistenceReady?.());

            await persistenceReadyPromise;

            // Initialize replicate helpers (plain function)
            initializeReplicateParams(params);

            // Signal that sync helpers are ready
            resolveOptimisticReady?.();

            // Apply SSR CRDT bytes to Yjs if available
            if (ssrCRDTBytes) {
              applyUpdate(ydoc, new Uint8Array(ssrCRDTBytes), YjsOrigin.SSRInit);
            }

            if (ymap.size > 0) {
              const items: T[] = [];
              ymap.forEach((itemYMap, _key) => {
                if (itemYMap instanceof Y.Map) {
                  items.push(itemYMap.toJSON() as T);
                }
              });

              // Use plain function for initial sync
              replicateInsert(items);

              logger.info('Initial sync completed', {
                collection,
                itemCount: items.length,
              });
            }

            await Effect.runPromise(reconcile().pipe(Effect.provide(servicesLayer)));

            // Use SSR checkpoint if available, otherwise load from IndexedDB
            const checkpoint =
              ssrCheckpoint ||
              (await Effect.runPromise(
                Effect.gen(function* () {
                  const checkpointSvc = yield* Checkpoint;
                  return yield* checkpointSvc.loadCheckpoint(collection);
                }).pipe(Effect.provide(CheckpointLive))
              ));

            // Define subscription handler as Effect program (for checkpoint saving)
            const subscriptionHandler = (response: any) =>
              Effect.gen(function* () {
                const checkpointSvc = yield* Checkpoint;

                const { changes, checkpoint: newCheckpoint } = response;

                for (const change of changes) {
                  const { operationType, crdtBytes, documentId } = change;

                  if (operationType === 'snapshot') {
                    // Apply snapshot to Yjs using plain function
                    applyUpdate(ydoc, new Uint8Array(crdtBytes), YjsOrigin.Snapshot);

                    // Replace all data in TanStack DB
                    const items: T[] = [];
                    ymap.forEach((itemYMap) => {
                      if (itemYMap instanceof Y.Map) {
                        items.push(itemYMap.toJSON() as T);
                      }
                    });
                    replicateReplace(items);
                  } else {
                    // Capture item data BEFORE applying delta
                    let itemBeforeDelta: T | null = null;
                    if (documentId) {
                      const itemYMapBefore = ymap.get(documentId);
                      if (itemYMapBefore instanceof Y.Map) {
                        itemBeforeDelta = itemYMapBefore.toJSON() as T;
                      }
                    }

                    // Apply delta to Yjs using plain function
                    applyUpdate(ydoc, new Uint8Array(crdtBytes), YjsOrigin.Subscription);

                    // Sync affected document to TanStack DB
                    if (documentId) {
                      const itemYMap = ymap.get(documentId);
                      if (itemYMap instanceof Y.Map) {
                        // Item EXISTS after delta - upsert
                        const item = itemYMap.toJSON() as T;
                        replicateUpsert([item]);
                      } else if (itemBeforeDelta) {
                        // Item DELETED by delta
                        replicateDelete([itemBeforeDelta]);
                      }
                    }
                  }
                }

                // Save checkpoint (still uses Effect for CheckpointService)
                yield* checkpointSvc.saveCheckpoint(collection, newCheckpoint);
              }).pipe(Effect.provide(servicesLayer));

            // Create subscription directly with convexClient.onUpdate()
            subscription = convexClient.onUpdate(
              api.stream,
              { checkpoint, limit: 100 },
              (response: any) => {
                // Run Effect handler - fire and forget (Convex callback is sync)
                Effect.runPromise(
                  subscriptionHandler(response).pipe(
                    Effect.catchAllCause((cause) =>
                      Effect.logError('Subscription handler error', { cause })
                    )
                  )
                );
              }
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

            persistence?.destroy();
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
