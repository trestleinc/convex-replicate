import * as Y from 'yjs';
import {
  startOfflineExecutor,
  NonRetriableError,
  type OfflineExecutor,
} from '@tanstack/offline-transactions';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import type { CollectionConfig, Collection } from '@tanstack/db';
import { getLogger } from './logger.js';

const logger = getLogger(['convex-replicate', 'collection']);

/**
 * Configuration for convexCollectionOptions (Step 1)
 * All params go here - they'll be used to create the collection config
 */
export interface ConvexCollectionOptionsConfig<T extends object> {
  /** Function to extract unique key from items */
  getKey: (item: T) => string | number;

  /** Optional initial data to populate collection */
  initialData?: ReadonlyArray<T>;

  /** Convex client instance */
  convexClient: ConvexClient;

  /** Convex API functions for this collection */
  api: {
    stream: FunctionReference<'query'>; // For streaming data from main table (required)
    insertDocument: FunctionReference<'mutation'>; // Insert handler (required)
    updateDocument: FunctionReference<'mutation'>; // Update handler (required)
    deleteDocument: FunctionReference<'mutation'>; // Delete handler (required)
  };

  /** Unique collection name */
  collectionName: string;
}

/**
 * ConvexCollection is now just a standard TanStack DB Collection!
 * No custom wrapper, no special methods - uses built-in transaction system.
 */
export type ConvexCollection<T extends object> = Collection<T>;

/**
 * Step 1: Create TanStack DB CollectionConfig with REAL mutation handlers.
 *
 * This implements the CORRECT pattern:
 * - Uses onInsert/onUpdate/onDelete handlers (not custom wrapper)
 * - Yjs Y.Doc with 'update' event for delta encoding
 * - Stores Y.Map instances (not plain objects) for field-level CRDT
 * - Uses ydoc.transact() to batch changes into single 'update' event
 *
 * @example
 * ```typescript
 * import { createCollection } from '@tanstack/react-db'
 * import { convexCollectionOptions } from '@trestleinc/convex-replicate-core'
 *
 * const rawCollection = createCollection(
 *   convexCollectionOptions<Task>({
 *     convexClient,
 *     api: api.tasks,
 *     collectionName: 'tasks',
 *     getKey: (task) => task.id,
 *     initialData,
 *   })
 * )
 * ```
 */
export function convexCollectionOptions<T extends object>({
  getKey,
  initialData,
  convexClient,
  api,
  collectionName,
}: ConvexCollectionOptionsConfig<T>): CollectionConfig<T> & {
  _convexClient: ConvexClient;
  _collectionName: string;
} {
  // Initialize Yjs document for CRDT operations
  const ydoc = new Y.Doc({ guid: collectionName });
  const ymap = ydoc.getMap(collectionName);

  // Track delta updates (NOT full state)
  // This is the key to efficient bandwidth usage: < 1KB per change instead of 100KB+
  let pendingUpdate: Uint8Array | null = null;
  (ydoc as any).on('update', (update: Uint8Array, origin: any) => {
    // `update` contains ONLY what changed (delta)
    pendingUpdate = update;
    logger.debug('Yjs update event fired', {
      collectionName,
      updateSize: update.length,
      origin,
    });
  });

  return {
    id: collectionName,
    getKey,

    // Store for extraction by createConvexCollection
    _convexClient: convexClient,
    _collectionName: collectionName,

    // REAL onInsert handler (called automatically by TanStack DB)
    onInsert: async ({ transaction }: any) => {
      logger.debug('onInsert handler called', {
        collectionName,
        mutationCount: transaction.mutations.length,
      });

      try {
        // Update Yjs in transaction (batches multiple changes into ONE 'update' event)
        ydoc.transact(() => {
          transaction.mutations.forEach((mut: any) => {
            // Store as Y.Map for field-level CRDT conflict resolution
            const itemYMap = new Y.Map();
            Object.entries(mut.modified as Record<string, unknown>).forEach(([k, v]) => {
              itemYMap.set(k, v);
            });
            ymap.set(String(mut.key), itemYMap);
          });
        }, 'insert');

        // Send DELTA to Convex (not full state)
        if (pendingUpdate) {
          logger.debug('Sending insert delta to Convex', {
            collectionName,
            documentId: String(transaction.mutations[0].key),
            deltaSize: pendingUpdate.length,
          });

          await convexClient.mutation(api.insertDocument, {
            collectionName,
            documentId: String(transaction.mutations[0].key),
            crdtBytes: pendingUpdate.buffer,
            materializedDoc: transaction.mutations[0].modified,
            version: Date.now(),
          });

          pendingUpdate = null;
          logger.info('Insert persisted to Convex', {
            collectionName,
            documentId: String(transaction.mutations[0].key),
          });
        }
      } catch (error: any) {
        logger.error('Insert failed', {
          collectionName,
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
      logger.debug('onUpdate handler called', {
        collectionName,
        mutationCount: transaction.mutations.length,
      });

      try {
        // Update Yjs in transaction
        ydoc.transact(() => {
          transaction.mutations.forEach((mut: any) => {
            const itemYMap = ymap.get(String(mut.key)) as Y.Map<any> | undefined;
            if (itemYMap) {
              // Update only changed fields (field-level CRDT)
              Object.entries((mut.modified as Record<string, unknown>) || {}).forEach(([k, v]) => {
                itemYMap.set(k, v);
              });
            } else {
              // Create new Y.Map if doesn't exist (defensive)
              const newYMap = new Y.Map();
              Object.entries(mut.modified as Record<string, unknown>).forEach(([k, v]) => {
                newYMap.set(k, v);
              });
              ymap.set(String(mut.key), newYMap);
            }
          });
        }, 'update');

        // Send delta to Convex
        if (pendingUpdate) {
          logger.debug('Sending update delta to Convex', {
            collectionName,
            documentId: String(transaction.mutations[0].key),
            deltaSize: pendingUpdate.length,
          });

          await convexClient.mutation(api.updateDocument, {
            collectionName,
            documentId: String(transaction.mutations[0].key),
            crdtBytes: pendingUpdate.buffer,
            materializedDoc: transaction.mutations[0].modified,
            version: Date.now(),
          });

          pendingUpdate = null;
          logger.info('Update persisted to Convex', {
            collectionName,
            documentId: String(transaction.mutations[0].key),
          });
        }
      } catch (error: any) {
        logger.error('Update failed', {
          collectionName,
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
      logger.debug('onDelete handler called', {
        collectionName,
        mutationCount: transaction.mutations.length,
      });

      try {
        // Remove from Yjs Y.Map - creates deletion tombstone
        ydoc.transact(() => {
          transaction.mutations.forEach((mut: any) => {
            ymap.delete(String(mut.key));
          });
        }, 'delete');

        // Send deletion DELTA to Convex
        if (pendingUpdate) {
          logger.debug('Sending delete delta to Convex', {
            collectionName,
            documentId: String(transaction.mutations[0].key),
            deltaSize: pendingUpdate.length,
          });

          await convexClient.mutation(api.deleteDocument, {
            collectionName,
            documentId: String(transaction.mutations[0].key),
            crdtBytes: pendingUpdate.buffer,
            version: Date.now(),
          });

          pendingUpdate = null;
          logger.info('Delete persisted to Convex', {
            collectionName,
            documentId: String(transaction.mutations[0].key),
          });
        }
      } catch (error: any) {
        logger.error('Delete failed', {
          collectionName,
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
      sync: (params: any) => {
        const { begin, write, commit, markReady } = params;

        // Step 1: Write initial SSR data to BOTH Yjs AND TanStack DB
        if (initialData && initialData.length > 0) {
          // Sync to Yjs first (for CRDT state)
          ydoc.transact(() => {
            for (const item of initialData) {
              const key = getKey(item);
              const itemYMap = new Y.Map();
              Object.entries(item as Record<string, unknown>).forEach(([k, v]) => {
                itemYMap.set(k, v);
              });
              ymap.set(String(key), itemYMap);
            }
          }, 'ssr-init');

          // Then sync to TanStack DB
          begin();
          for (const item of initialData) {
            write({ type: 'insert', value: item });
          }
          commit();
          logger.debug('Initialized with SSR data', {
            collectionName,
            count: initialData.length,
          });
        }

        // Step 2: Subscribe to Convex real-time updates via main table
        logger.debug('Setting up Convex subscription', { collectionName });

        // Track previous items (full objects) to detect hard deletes
        // We need full items because TanStack DB write() expects { type: 'delete', value: T }
        let previousItems = new Map<string | number, T>();

        const subscription = convexClient.onUpdate(api.stream, {}, async (items) => {
          try {
            logger.debug('Subscription update received', {
              collectionName,
              itemCount: items.length,
            });

            // Build map of current items
            const currentItems = new Map<string | number, T>();
            for (const item of items) {
              const key = getKey(item as T);
              currentItems.set(key, item as T);
            }

            // Detect hard deletes by finding items in previous but not in current
            const deletedItems: T[] = [];
            for (const [prevId, prevItem] of previousItems) {
              if (!currentItems.has(prevId)) {
                deletedItems.push(prevItem);
              }
            }

            if (deletedItems.length > 0) {
              logger.info('Detected remote hard deletes', {
                collectionName,
                deletedCount: deletedItems.length,
                deletedIds: deletedItems.map((item) => getKey(item)),
              });
            }

            begin();

            // STEP 1: Handle deletions FIRST
            for (const deletedItem of deletedItems) {
              const deletedId = getKey(deletedItem);

              // Remove from Yjs (requires string key)
              ydoc.transact(() => {
                ymap.delete(String(deletedId));
              }, 'remote-delete');

              // Remove from TanStack DB (requires full item as value)
              write({ type: 'delete', value: deletedItem });
            }

            // STEP 2: Sync items to Yjs
            ydoc.transact(() => {
              for (const item of items) {
                const key = getKey(item as T);
                const itemYMap = new Y.Map();
                Object.entries(item as Record<string, unknown>).forEach(([k, v]) => {
                  itemYMap.set(k, v);
                });
                ymap.set(String(key), itemYMap);
              }
            }, 'subscription-sync');

            // STEP 3: Sync items to TanStack DB
            for (const item of items) {
              const key = getKey(item as T);

              if ((params as any).collection.has(key)) {
                write({ type: 'update', value: item as T });
              } else {
                write({ type: 'insert', value: item as T });
              }
            }

            commit();

            // Update tracking for next iteration
            previousItems = currentItems;

            logger.debug('Successfully synced items to collection', {
              count: items.length,
              deletedCount: deletedItems.length,
            });
          } catch (error: any) {
            logger.error('Failed to sync items from subscription', {
              error: error.message,
              errorName: error.name,
              stack: error?.stack,
              collectionName,
              itemCount: items.length,
            });
            throw error; // Re-throw to prevent silent failures
          }
        });

        markReady();

        // Return cleanup function
        return () => {
          logger.debug('Cleaning up Convex subscription', { collectionName });
          subscription();
        };
      },
    },
  };
}

/**
 * Step 2: Wrap collection with offline support.
 *
 * This implements the CORRECT pattern:
 * - Wraps collection ONCE with startOfflineExecutor
 * - Returns raw collection (NO CUSTOM WRAPPER)
 * - Uses beforeRetry filter for stale transactions
 * - Connects to Convex connection state for retry triggers
 *
 * Config is automatically extracted from the rawCollection!
 *
 * @example
 * ```typescript
 * import { createCollection } from '@tanstack/react-db'
 * import { convexCollectionOptions, createConvexCollection } from '@trestleinc/convex-replicate-core'
 *
 * // Step 1: Create raw collection with ALL config
 * const rawCollection = createCollection(
 *   convexCollectionOptions<Task>({
 *     convexClient,
 *     api: api.tasks,
 *     collectionName: 'tasks',
 *     getKey: (task) => task.id,
 *     initialData,
 *   })
 * )
 *
 * // Step 2: Wrap with offline support - params automatically extracted!
 * const collection = createConvexCollection(rawCollection)
 *
 * // Use like a normal TanStack DB collection
 * const tx = collection.insert({ id: '1', text: 'Buy milk', isCompleted: false })
 * await tx.isPersisted.promise  // Built-in promise (not custom awaitReplication)
 * ```
 */
export function createConvexCollection<T extends object>(
  rawCollection: Collection<T>
): ConvexCollection<T> {
  // Extract config from rawCollection
  const config = (rawCollection as any).config;
  const convexClient = config._convexClient;
  const collectionName = config._collectionName;

  if (!convexClient || !collectionName) {
    throw new Error(
      'createConvexCollection requires a collection created with convexCollectionOptions. ' +
        'Make sure you pass convexClient and collectionName to convexCollectionOptions.'
    );
  }

  logger.info('Creating Convex collection with offline support', { collectionName });

  // Create offline executor (wraps collection ONCE)
  const offline: OfflineExecutor = startOfflineExecutor({
    collections: { [collectionName]: rawCollection as any },

    // Empty mutationFns - handlers in collection config will be used
    mutationFns: {},

    // Filter stale transactions before retry
    beforeRetry: (transactions) => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
      const filtered = transactions.filter((tx) => {
        const isRecent = tx.createdAt.getTime() > cutoff;
        const notExhausted = tx.retryCount < 10;
        return isRecent && notExhausted;
      });

      if (filtered.length < transactions.length) {
        logger.warn('Filtered stale transactions', {
          collectionName,
          before: transactions.length,
          after: filtered.length,
        });
      }

      return filtered;
    },

    onLeadershipChange: (isLeader) => {
      logger.info(isLeader ? 'Offline mode active' : 'Online-only mode', {
        collectionName,
      });
    },

    onStorageFailure: (diagnostic) => {
      logger.warn('Storage failed - online-only mode', {
        collectionName,
        code: diagnostic.code,
        message: diagnostic.message,
      });
    },
  });

  // Subscribe to Convex connection state for automatic retry trigger
  if (convexClient.connectionState) {
    const connectionState = convexClient.connectionState();
    logger.debug('Initial connection state', {
      collectionName,
      isConnected: connectionState.isWebSocketConnected,
    });
  }

  // Trigger retry when connection is restored
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      logger.info('Network online - notifying offline executor', { collectionName });
      offline.notifyOnline();
    });
  }

  logger.info('Offline support initialized', {
    collectionName,
    mode: offline.mode,
  });

  // Return collection directly - NO WRAPPER!
  // Users call collection.insert/update/delete as normal
  // Handlers run automatically, offline-transactions handles persistence
  return rawCollection as ConvexCollection<T>;
}
