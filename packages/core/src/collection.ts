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
    getTasks: FunctionReference<'query'>;
    changeStream: FunctionReference<'query'>;
    insertDocument: FunctionReference<'mutation'>;
    updateDocument: FunctionReference<'mutation'>;
    deleteDocument: FunctionReference<'mutation'>;
  };

  /** Unique collection name */
  collectionName: string;
}

/**
 * Wrapped collection with offline support and CRDT sync.
 *
 * Extends Collection<T> to ensure full compatibility with useLiveQuery and other
 * TanStack DB utilities. All Collection methods are available via Proxy forwarding,
 * while mutation methods (insert/update/delete) are wrapped with offline transaction support.
 */
export interface ConvexCollection<T extends object> extends Collection<T> {
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
} {
  return {
    getKey,

    // Store Convex params for extraction by createConvexCollection
    _convexClient: convexClient,
    _api: api,
    _collectionName: collectionName,

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

        // Step 2: Subscribe to Convex real-time updates
        logger.debug('Setting up Convex subscription', { collectionName });

        let lastSnapshot: any = null;

        // Watch changeStream for updates
        const subscription = convexClient.onUpdate(
          api.changeStream,
          { collectionName },
          async (snapshot) => {
            if (snapshot && snapshot !== lastSnapshot) {
              lastSnapshot = snapshot;
              logger.debug('Change detected, refetching tasks', { collectionName, snapshot });

              try {
                // Fetch updated data from Convex
                const tasks = await convexClient.query(api.getTasks, {});

                logger.debug('Refetched tasks from Convex', { count: tasks.length });

                // Update the collection - check if each item exists and use appropriate operation
                // Note: TanStack DB only supports 'insert', 'update', 'delete' - NO 'upsert'!
                begin();
                for (const task of tasks) {
                  const key = getKey(task);
                  // Check if item exists in collection to determine insert vs update
                  if ((params as any).collection.has(key)) {
                    write({ type: 'update', value: task });
                  } else {
                    write({ type: 'insert', value: task });
                  }
                }
                commit();

                logger.debug('Successfully synced tasks to collection', { count: tasks.length });
              } catch (error: any) {
                logger.error('Failed to refetch tasks', {
                  error: error.message,
                  errorString: String(error),
                  stack: error?.stack?.split('\n')[0],
                });
              }
            }
          }
        );

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
 * Step 2: Wrap a TanStack DB Collection with Convex offline + Yjs CRDT support.
 *
 * This wraps your raw TanStack DB collection with:
 * - Yjs for CRDT operations (96% smaller than Automerge, no WASM, React Native compatible)
 * - TanStack DB's OfflineExecutor for outbox pattern, retry logic, and multi-tab coordination
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

  if (!convexClient || !api || !collectionName) {
    throw new Error(
      'createConvexCollection requires a collection created with convexCollectionOptions. ' +
        'Make sure you pass convexClient, api, and collectionName to convexCollectionOptions.'
    );
  }

  // Create Yjs document for CRDT operations
  const ydoc = new Y.Doc({ guid: collectionName });
  const ymap = ydoc.getMap(collectionName);

  // Note: We don't pull CRDT bytes for reading anymore.
  // Instead, we rely on the subscription in convexCollectionOptions which:
  // 1. Writes initialData from SSR (materialized docs from getTasks)
  // 2. Subscribes to changeStream for real-time updates
  // The Yjs/CRDT layer is only used for encoding mutations before sending to Convex.

  // Create offline executor
  const offline = startOfflineExecutor({
    collections: { [collectionName]: rawCollection as any },

    mutationFns: {
      syncToConvex: async ({ transaction, idempotencyKey }) => {
        logger.debug('syncToConvex', {
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
          if (mutation.type === 'delete') {
            // Delete only needs collectionName and documentId
            await convexClient.mutation(mutationFn, {
              collectionName,
              documentId: String(mutation.key),
            });
          } else {
            // Insert and update need full payload
            await convexClient.mutation(mutationFn, {
              collectionName,
              documentId: String(mutation.key),
              crdtBytes: update.buffer,
              materializedDoc: mutation.modified,
              version: Date.now(),
            });
          }

          logger.info('Synced to Convex', {
            type: mutation.type,
            key: mutation.key,
            idempotencyKey,
          });
        } catch (error: any) {
          logger.error('Sync failed', {
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

  // Create wrapper object with mutation methods
  const wrapper = {
    // Wrap insert to use offline transactions
    insert: (item: T | T[], config?: OperationConfig) => {
      const tx = offline.createOfflineTransaction({
        mutationFnName: 'syncToConvex',
        autoCommit: true, // Auto-commit triggers sync immediately (online or queues offline)
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
        mutationFnName: 'syncToConvex',
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
        mutationFnName: 'syncToConvex',
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
