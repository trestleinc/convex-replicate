import * as Y from 'yjs';
import {
  startOfflineExecutor,
  NonRetriableError,
  type OfflineExecutor,
} from '@tanstack/offline-transactions';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import type { CollectionConfig, Collection, OperationConfig } from '@tanstack/db';
import { getLogger } from './logger.js';

const logger = getLogger(['convex-replicate', 'collection']);

/**
 * Configuration for convexCollectionOptions (Step 1)
 * All params go here - they'll be stored in the collection config for extraction later
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
    stream: FunctionReference<'query'>;
    list: FunctionReference<'query'>; // For subscriptions to main table
    insertDocument: FunctionReference<'mutation'>;
    updateDocument: FunctionReference<'mutation'>;
    deleteDocument: FunctionReference<'mutation'>;
  };

  /** Unique collection name */
  collectionName: string;
}

/**
 * Wrapped collection with offline support and CRDT replication.
 *
 * Extends Collection<T> to ensure full compatibility with useLiveQuery and other
 * TanStack DB utilities. All Collection methods are available via Proxy forwarding,
 * while mutation methods (insert/update/delete) are wrapped with offline transaction support.
 */
export interface ConvexCollection<T extends object> extends Collection<T> {
  // Utilities for advanced replication control
  utils: {
    /**
     * Wait for a mutation to replicate back from the server.
     * Useful for ensuring data consistency before proceeding with dependent operations.
     *
     * @param timestamp - The mutation timestamp to match
     * @param documentId - The document ID to match
     * @param timeout - Timeout in milliseconds (default: 30000)
     * @throws Error if replication times out
     */
    awaitReplication: (timestamp: number, documentId: string, timeout?: number) => Promise<void>;

    /**
     * Manually refetch all data from the server.
     * Useful for forcing a refresh of stale data.
     */
    refetch: () => Promise<void>;
  };

  // Internal access (for advanced use)
  _rawCollection: Collection<T>;
  _offlineExecutor: OfflineExecutor;
  _ydoc: Y.Doc;
}

/**
 * Step 1: Create basic TanStack DB CollectionConfig.
 *
 * This returns a lightweight config that you pass to your framework's createCollection().
 *
 * @example
 * ```typescript
 * import { createCollection } from '@tanstack/react-db'
 * import { convexCollectionOptions } from '@trestleinc/convex-replicate-core'
 *
 * const rawCollection = createCollection(
 *   convexCollectionOptions<Task>({
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
}: ConvexCollectionOptionsConfig<T>): CollectionConfig<T | (Partial<T> & T)> & {
  _convexClient: ConvexClient;
  _api: typeof api;
  _collectionName: string;
  _seenUpdates: Map<string, number>;
} {
  // Track seen document updates for instant replication confirmation
  // Shared between subscription and awaitReplication
  const seenUpdates = new Map<string, number>();

  return {
    getKey,

    // Store Convex params for extraction by createConvexCollection
    _convexClient: convexClient,
    _api: api,
    _collectionName: collectionName,
    _seenUpdates: seenUpdates,

    sync: {
      sync: (params: any) => {
        const { begin, write, commit, markReady } = params;

        // Step 1: Write initial SSR data
        if (initialData && initialData.length > 0) {
          begin();
          for (const item of initialData) {
            write({ type: 'insert', value: item });
          }
          commit();
        }

        // Step 2: Subscribe to Convex real-time updates via main table
        logger.debug('Setting up Convex subscription', { collectionName });

        // Subscribe to the list query which reads from the main table
        // Convex will automatically push updates when data changes
        const subscription = convexClient.onUpdate(api.list, {}, async (items) => {
          try {
            logger.debug('List subscription update received', {
              collectionName,
              itemCount: items.length,
            });

            // Track seen updates for instant replication confirmation
            // Items must have 'id' and 'timestamp' fields matching our schema
            for (const item of items) {
              const itemAny = item as any;
              if (itemAny.id && itemAny.timestamp) {
                seenUpdates.set(itemAny.id, itemAny.timestamp);
              }
            }

            // Sync all items from server to TanStack DB
            begin();
            for (const item of items) {
              const key = getKey(item as T);

              // Check if item exists to determine insert vs update
              if ((params as any).collection.has(key)) {
                write({ type: 'update', value: item as T });
              } else {
                write({ type: 'insert', value: item as T });
              }
            }
            commit();

            logger.debug('Successfully synced items to collection', {
              count: items.length,
              trackedUpdates: seenUpdates.size,
            });
          } catch (error: any) {
            logger.error('Failed to sync items from subscription', {
              error: error.message,
              errorString: String(error),
              stack: error?.stack?.split('\n')[0],
            });
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

    // No-op handlers - required so rawCollection.insert/update/delete don't throw MissingHandlerError
    // Actual sync to Convex happens in createConvexCollection's offline executor
    onInsert: async ({ transaction }: any) => {
      logger.debug('onInsert', {
        mutations: transaction.mutations.length,
      });
    },
    onUpdate: async ({ transaction }: any) => {
      logger.debug('onUpdate', {
        mutations: transaction.mutations.length,
      });
    },
    onDelete: async ({ transaction }: any) => {
      logger.debug('onDelete', {
        mutations: transaction.mutations.length,
      });
    },
  } as any;
}

/**
 * Step 2: Wrap a TanStack DB Collection with Convex offline replication + Yjs CRDT support.
 *
 * This wraps your raw TanStack DB collection with:
 * - Yjs for CRDT operations (96% smaller than Automerge, no WASM, React Native compatible)
 * - TanStack DB's OfflineExecutor for outbox pattern, retry logic, and multi-tab replication
 *
 * Config is automatically extracted from the rawCollection - no need to pass params again!
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
 * // Step 2: Wrap - params automatically extracted!
 * const collection = createConvexCollection(rawCollection)
 *
 * // Use like a normal TanStack DB collection
 * collection.insert({ id: '1', text: 'Buy milk', isCompleted: false })
 * collection.update('1', (draft) => { draft.isCompleted = true })
 * collection.delete('1')
 * ```
 */
export function createConvexCollection<T extends object>(
  rawCollection: Collection<T>
): ConvexCollection<T> {
  // Extract config from rawCollection - no need to pass params again!
  const config = (rawCollection as any).config;
  const convexClient = config._convexClient;
  const api = config._api;
  const collectionName = config._collectionName;
  const getKey = config.getKey;
  const seenUpdates = config._seenUpdates; // Shared with subscription

  if (!convexClient || !api || !collectionName || !seenUpdates) {
    throw new Error(
      'createConvexCollection requires a collection created with convexCollectionOptions. ' +
        'Make sure you pass convexClient, api, and collectionName to convexCollectionOptions.'
    );
  }

  // Create Yjs document for CRDT operations
  const ydoc = new Y.Doc({ guid: collectionName });
  const ymap = ydoc.getMap(collectionName);

  // Note: We don't fetch CRDT bytes for reading anymore.
  // Instead, we rely on the subscription in convexCollectionOptions which:
  // 1. Writes initialData from SSR (materialized docs)
  // 2. Subscribes to list query which tracks seen updates in seenUpdates map
  // The Yjs/CRDT layer is only used for encoding mutations before sending to Convex.

  /**
   * Wait for a mutation to replicate back from the server.
   * First checks seenUpdates map (instant), then falls back to polling stream query.
   *
   * @param timestamp - The mutation timestamp to match
   * @param documentId - The document ID to match
   * @param timeout - Timeout in milliseconds (default: 30000)
   */
  async function awaitReplication(
    timestamp: number,
    documentId: string,
    timeout = 30000
  ): Promise<void> {
    const startTime = Date.now();

    logger.debug('awaitReplication started', { timestamp, documentId, timeout });

    // Fast path: Check seenUpdates map first (instant lookup from subscription)
    const checkSeenUpdates = () => {
      const seenTimestamp = seenUpdates.get(documentId);
      if (seenTimestamp && seenTimestamp >= timestamp) {
        logger.debug('awaitReplication found in seenUpdates (instant)', {
          documentId,
          timestamp,
          seenTimestamp,
          elapsed: Date.now() - startTime,
        });
        return true;
      }
      return false;
    };

    // Check immediately
    if (checkSeenUpdates()) return;

    // Poll the seenUpdates map (much faster than network queries)
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        clearInterval(intervalId);
        logger.warn('awaitReplication timeout', {
          documentId,
          timestamp,
          timeout,
          elapsed: Date.now() - startTime,
        });
        reject(new Error(`Sync timeout for document ${documentId} after ${timeout}ms`));
      }, timeout);

      // Check every 50ms (subscription will update seenUpdates)
      const intervalId = setInterval(() => {
        if (checkSeenUpdates()) {
          clearInterval(intervalId);
          clearTimeout(timeoutId);
          resolve();
        }
      }, 50);
    });
  }

  // Create offline executor
  const offline = startOfflineExecutor({
    collections: { [collectionName]: rawCollection as any },

    mutationFns: {
      replicateToConvex: async ({ transaction, idempotencyKey }) => {
        logger.debug('replicateToConvex', {
          mutations: transaction.mutations.length,
          types: transaction.mutations.map((m) => m.type).join(','),
          idempotencyKey, // Log for debugging but don't send to Convex
        });

        try {
          // Encode current Yjs state as update
          const update = Y.encodeStateAsUpdate(ydoc);

          // Determine mutation type
          const mutation = transaction.mutations[0];
          if (!mutation) {
            logger.warn('Empty transaction', { collectionName });
            return;
          }

          const mutationFn =
            mutation.type === 'insert'
              ? api.insertDocument
              : mutation.type === 'update'
                ? api.updateDocument
                : api.deleteDocument;

          logger.debug('Preparing Convex mutation', {
            type: mutation.type,
            key: mutation.key,
            updateLength: update.length,
            updateType: update.constructor.name,
            idempotencyKey,
          });

          // Send to Convex (will be persisted to both component + main table)
          // Note: idempotencyKey is NOT sent to Convex - it's for offline-transactions internal use only
          // Convert Uint8Array to ArrayBuffer for Convex v.bytes()
          let result: any;

          if (mutation.type === 'delete') {
            // Delete only needs collectionName and documentId
            result = await convexClient.mutation(mutationFn, {
              collectionName,
              documentId: String(mutation.key),
            });
          } else {
            // Insert and update need full payload
            result = await convexClient.mutation(mutationFn, {
              collectionName,
              documentId: String(mutation.key),
              crdtBytes: update.buffer,
              materializedDoc: mutation.modified,
              version: Date.now(),
            });
          }

          logger.info('Mutation sent to Convex', {
            type: mutation.type,
            key: mutation.key,
            result,
            hasMetadata: !!result?.metadata,
            idempotencyKey,
          });

          // KEY CHANGE: Block until mutation replicates back from server
          // This prevents flicker by ensuring optimistic state stays until server confirms
          // BUT: Only wait for FRESH mutations (< 2 seconds old) to enable fast offline queue sync
          if (result?.metadata) {
            const transactionAge = Date.now() - transaction.createdAt.getTime();
            const isFreshMutation = transactionAge < 2000; // 2 second threshold

            if (isFreshMutation) {
              // Fresh mutation from user action - wait to prevent flicker
              logger.debug('Waiting for replication confirmation (fresh mutation)', {
                documentId: result.metadata.documentId,
                timestamp: result.metadata.timestamp,
                transactionAge,
                idempotencyKey,
              });

              await awaitReplication(
                result.metadata.timestamp,
                result.metadata.documentId,
                30000 // 30 second timeout
              );

              logger.info('Replication confirmed', {
                documentId: result.metadata.documentId,
                elapsed: Date.now() - result.metadata.timestamp,
                idempotencyKey,
              });
            } else {
              // Old transaction from offline queue - skip wait for fast sync
              logger.debug('Skipping replication wait (offline queue replay)', {
                documentId: result.metadata.documentId,
                timestamp: result.metadata.timestamp,
                transactionAge,
                idempotencyKey,
              });
            }
          }
        } catch (error: any) {
          logger.error('Replication failed', {
            collectionName,
            errorMessage: error?.message || 'Unknown error',
            errorName: error?.name,
            errorStack: error?.stack,
            errorStatus: error?.status,
            idempotencyKey,
          });

          // Developer-controlled error classification
          if (error?.status === 401 || error?.status === 403) {
            throw new NonRetriableError('Authentication failed');
          }
          if (error?.status === 422) {
            throw new NonRetriableError('Validation error');
          }

          // Everything else retries automatically
          throw error;
        }
      },
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
      });
    },
  });

  // Create utils object for advanced replication control
  const utils = {
    awaitReplication,
    refetch: async () => {
      logger.debug('Manual refetch requested', { collectionName });
      try {
        const tasks = await convexClient.query(api.getTasks, {});
        logger.debug('Refetched tasks from Convex', { count: tasks.length });

        // This will trigger the sync to write new data
        // (Implementation would need access to begin/write/commit from sync config)
        // For now, this is a placeholder - actual refetch happens via stream
        logger.warn('Manual refetch not yet fully implemented - use stream subscription');
      } catch (error: any) {
        logger.error('Manual refetch failed', {
          error: error?.message,
        });
        throw error;
      }
    },
  };

  // Create wrapper object with mutation methods
  const wrapper = {
    // Wrap insert to use offline transactions
    insert: (item: T | T[], config?: OperationConfig) => {
      const tx = offline.createOfflineTransaction({
        mutationFnName: 'replicateToConvex',
        autoCommit: true, // Auto-commit triggers replication immediately (online or queues offline)
      });

      tx.mutate(() => {
        // Call raw collection inside ambient transaction (optimistic update)
        rawCollection.insert(item, config);

        // Update Yjs Map (ALWAYS - for CRDT conflict resolution)
        const items = Array.isArray(item) ? item : [item];
        items.forEach((i) => {
          ymap.set(String(getKey(i)), i);
        });
      });

      return tx;
    },

    // Wrap update to use offline transactions
    update: (key: string | number, updater: (draft: T) => void, config?: OperationConfig) => {
      const tx = offline.createOfflineTransaction({
        mutationFnName: 'replicateToConvex',
        autoCommit: true,
      });

      tx.mutate(() => {
        // Call raw collection inside ambient transaction
        (rawCollection as any).update(key, updater, config);

        // Update Yjs Map
        const updated = rawCollection.get(key);
        if (updated) {
          ymap.set(String(key), updated);
        }
      });

      return tx;
    },

    // Wrap delete to use offline transactions
    delete: (key: string | number | Array<string | number>, config?: OperationConfig) => {
      const tx = offline.createOfflineTransaction({
        mutationFnName: 'replicateToConvex',
        autoCommit: true,
      });

      tx.mutate(() => {
        // Call raw collection inside ambient transaction
        rawCollection.delete(key, config);

        // Update Yjs Map
        const keys = Array.isArray(key) ? key : [key];
        for (const k of keys) {
          ymap.delete(String(k));
        }
      });

      return tx;
    },

    // Pass-through read methods
    get: (key: string | number) => rawCollection.get(key),
    has: (key: string | number) => rawCollection.has(key),
    toArray: rawCollection.toArray,

    // Expose utils for replication control
    utils,

    // Expose internals for advanced use
    _rawCollection: rawCollection,
    _offlineExecutor: offline,
    _ydoc: ydoc,
  };

  // Use a Proxy to forward any unknown properties/methods to the raw collection
  // This ensures TanStack DB internal methods are accessible while maintaining
  // our custom mutation wrappers and internal properties.
  //
  // TypeScript limitation: Proxies can't be fully type-safe, so we cast to ConvexCollection<T>
  // which extends Collection<T>, telling TypeScript "trust me, all Collection methods exist".
  return new Proxy(wrapper, {
    get(target: any, prop: string | symbol) {
      // If the wrapper has the property, return it
      if (prop in target) {
        return target[prop];
      }
      // Otherwise, forward to the raw collection
      const rawValue = (rawCollection as any)[prop];
      // If it's a function, bind it to the raw collection
      if (typeof rawValue === 'function') {
        return rawValue.bind(rawCollection);
      }
      return rawValue;
    },
  }) as unknown as ConvexCollection<T>;
}
