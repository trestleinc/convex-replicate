/**
 * Main ConvexRx React hook - Simple by default, infinitely extensible.
 *
 * Provides offline-first sync between RxDB (local) and Convex (cloud)
 * with reactive React updates via TanStack DB.
 *
 * @example Basic usage
 * ```typescript
 * const tasks = useConvexRx({
 *   table: 'tasks',
 *   schema: taskSchema,
 *   convexApi: api.tasks,
 * });
 *
 * // Use base CRUD operations
 * tasks.insert({ text: 'New task', isCompleted: false });
 * tasks.update(id, { isCompleted: true });
 * tasks.delete(id);
 * ```
 *
 * @example With custom actions
 * ```typescript
 * const tasks = useConvexRx({
 *   table: 'tasks',
 *   schema: taskSchema,
 *   convexApi: api.tasks,
 *   actions: (base, ctx) => ({
 *     toggle: async (id: string) => {
 *       const doc = await ctx.rxCollection.findOne(id).exec();
 *       if (doc) await base.update(id, { isCompleted: !doc.isCompleted });
 *     },
 *   }),
 * });
 *
 * // Use both base and custom actions
 * tasks.toggle(id);
 * tasks.insert({ text: 'New', isCompleted: false });
 * ```
 */

import {
  type ConvexRxDBConfig,
  type BaseActions,
  type SyncedDocument,
  getLogger,
  getSingletonInstance,
  removeSingletonInstance,
  createSingletonKey,
  wrapActionsWithMiddleware,
  setupSyncErrorMiddleware,
  buildSubscriptions,
  createBaseActions,
} from '@convex-rx/core';
import React from 'react';
import { createConvexRx } from './createConvexRx';
import { useConvexRxContext } from './ConvexRxProvider';
import type { HookContext, UseConvexRxConfig, UseConvexRxResult } from './types';

/**
 * Main ConvexRx hook for offline-first sync with Convex.
 *
 * IMPORTANT: Requires ConvexRxProvider to be set up at app root.
 *
 * Features:
 * - Automatic singleton management (no race conditions)
 * - Real-time sync via WebSocket change streams
 * - Offline-first writes with automatic retry
 * - Cross-tab synchronization
 * - Type-safe CRUD operations
 * - Extensible via actions, queries, subscriptions, and middleware
 *
 * @param config - Hook configuration
 * @returns Result with data, loading state, actions, and extensions
 * @throws Error if ConvexRxProvider is not found in component tree
 */
export function useConvexRx<
  TData extends SyncedDocument,
  TActions extends Record<string, (...args: any[]) => any> = Record<string, never>,
  TQueries extends Record<string, (...args: any[]) => any> = Record<string, never>,
  TSubscriptions extends Record<
    string,
    (...args: any[]) => (() => void) | { unsubscribe: () => void }
  > = Record<string, never>,
>(
  config: UseConvexRxConfig<TData, TActions, TQueries, TSubscriptions>
): UseConvexRxResult<TData, TActions, TQueries, TSubscriptions> {
  // ========================================
  // 1. GET CONFIG FROM REQUIRED PROVIDER
  // ========================================

  const contextConfig = useConvexRxContext();

  // Merge context config with hook config (hook can override context defaults)
  const mergedConfig = React.useMemo(() => {
    return {
      databaseName: config.databaseName || contextConfig.databaseName || config.table,
      collectionName: config.table,
      schema: config.schema,
      convexClient: contextConfig.convexClient,
      convexApi: config.convexApi,
      batchSize: config.batchSize ?? contextConfig.batchSize,
      enableLogging: config.enableLogging ?? contextConfig.enableLogging,
      conflictHandler: config.conflictHandler || contextConfig.conflictHandler,
    } satisfies ConvexRxDBConfig<TData>;
  }, [
    config.table,
    config.schema,
    config.convexApi,
    config.databaseName,
    config.batchSize,
    config.enableLogging,
    config.conflictHandler,
    contextConfig,
  ]);

  // ========================================
  // 2. INITIALIZE SYNC INSTANCE (SINGLETON)
  // ========================================

  const [syncInstance, setSyncInstance] = React.useState<Awaited<
    ReturnType<typeof createConvexRx<TData>>
  > | null>(null);
  const [initError, setInitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const abortController = new AbortController();

    const init = async () => {
      try {
        const instance = await getSingletonInstance(mergedConfig, {
          keyFn: (cfg) => createSingletonKey(cfg.databaseName, cfg.collectionName),
          createFn: createConvexRx,
        });

        if (!abortController.signal.aborted) {
          setSyncInstance(instance);
          setInitError(null);
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          setInitError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    init();

    return () => {
      abortController.abort();
    };
  }, [mergedConfig]);

  // ========================================
  // 3. SUBSCRIBE TO COLLECTION CHANGES
  // ========================================

  const [data, setData] = React.useState<TData[]>(config.initialData || []);
  const [isLoading, setIsLoading] = React.useState(!config.initialData);

  React.useEffect(() => {
    if (!syncInstance) return;

    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    const logger = getLogger(config.table, mergedConfig.enableLogging ?? false);

    const subscribe = () => {
      try {
        const { collection } = syncInstance;

        // Subscribe to collection changes using TanStack API
        subscription = collection.subscribeChanges(
          () => {
            if (!mounted) return;

            try {
              // Access collection data (toArray is a getter, not a method)
              const items: TData[] = collection.toArray;

              logger.debug('Collection items', { itemCount: items.length });

              // Filter out soft-deleted items (_deleted: true)
              const activeItems = items.filter((item) => !item._deleted);

              logger.debug('Active items after filtering', { activeItemCount: activeItems.length });

              setData(activeItems);
              setIsLoading(false);
            } catch (accessError) {
              logger.error('Failed to access collection data', { error: accessError });
              setIsLoading(false);
            }
          },
          {
            includeInitialState: true, // Get initial state immediately
          }
        );
      } catch (subscribeError) {
        if (mounted) {
          logger.error('Failed to subscribe', { error: subscribeError });
          setIsLoading(false);
        }
      }
    };

    subscribe();

    return () => {
      mounted = false;
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [syncInstance, config.table, mergedConfig.enableLogging]);

  // ========================================
  // 4. CREATE BASE ACTIONS
  // ========================================

  const baseActions = React.useMemo<BaseActions<TData>>(() => {
    if (!syncInstance) {
      // Return disabled actions if not initialized
      return {
        insert: async () => {
          throw new Error('Sync not initialized');
        },
        update: async () => {
          throw new Error('Sync not initialized');
        },
        delete: async () => {
          throw new Error('Sync not initialized');
        },
      };
    }

    const { collection, rxCollection } = syncInstance;

    // Use core action factory with TanStack DB collection wrapper
    return createBaseActions<TData>({
      rxCollection,
      insertFn: async (doc) => {
        collection.insert(doc);
      },
      updateFn: async (id, updater) => {
        collection.update(id, updater as any);
      },
    });
  }, [syncInstance]);

  // ========================================
  // 5. APPLY MIDDLEWARE TO BASE ACTIONS
  // ========================================

  const wrappedActions = React.useMemo<BaseActions<TData>>(() => {
    return wrapActionsWithMiddleware(baseActions, config.middleware);
  }, [baseActions, config.middleware]);

  // ========================================
  // 6. SETUP SYNC ERROR MIDDLEWARE
  // ========================================

  React.useEffect(() => {
    if (!syncInstance || !config.middleware?.onSyncError) return;

    const cleanup = setupSyncErrorMiddleware(syncInstance.replicationState, config.middleware);

    return cleanup; // No need for null check - always returns a function
  }, [syncInstance, config.middleware]);

  // ========================================
  // 7. BUILD EXTENSION CONTEXT
  // ========================================

  const extensionContext = React.useMemo<HookContext<TData> | null>(() => {
    if (!syncInstance) return null;

    return {
      collection: syncInstance.collection,
      rxCollection: syncInstance.rxCollection,
      database: syncInstance.database,
      replicationState: syncInstance.replicationState,
    };
  }, [syncInstance]);

  // ========================================
  // 8. BUILD CUSTOM ACTIONS
  // ========================================

  const customActions = React.useMemo<TActions>(() => {
    if (!config.actions || !extensionContext) {
      return {} as TActions;
    }

    return config.actions(wrappedActions, extensionContext);
  }, [config, wrappedActions, extensionContext]);

  // ========================================
  // 9. BUILD CUSTOM QUERIES
  // ========================================

  const customQueries = React.useMemo<TQueries>(() => {
    if (!config.queries || !extensionContext) {
      return {} as TQueries;
    }

    return config.queries(extensionContext);
  }, [config, extensionContext]);

  // ========================================
  // 10. BUILD CUSTOM SUBSCRIPTIONS
  // ========================================

  const customSubscriptions = React.useMemo<TSubscriptions>(() => {
    if (!extensionContext) {
      return {} as TSubscriptions;
    }

    return buildSubscriptions(config.subscriptions, extensionContext);
  }, [config.subscriptions, extensionContext]);

  // ========================================
  // 11. PURGE STORAGE FUNCTION
  // ========================================

  const purgeStorage = React.useCallback(async () => {
    if (!syncInstance) return;

    try {
      await syncInstance.cleanup();
      removeSingletonInstance(
        createSingletonKey(mergedConfig.databaseName, mergedConfig.collectionName)
      );
      window.location.reload();
    } catch (error) {
      const logger = getLogger(config.table, mergedConfig.enableLogging ?? false);
      logger.error('Failed to purge storage', { error });
      // Try to reload anyway
      window.location.reload();
    }
  }, [
    syncInstance,
    mergedConfig.databaseName,
    mergedConfig.collectionName,
    config.table,
    mergedConfig.enableLogging,
  ]);

  // ========================================
  // 12. RETURN UNIFIED RESULT
  // ========================================

  return {
    // Data
    data,
    isLoading: !syncInstance || isLoading,
    error: initError,

    // Base actions (always available)
    insert: wrappedActions.insert,
    update: wrappedActions.update,
    delete: wrappedActions.delete,

    // Custom extensions
    actions: customActions,
    queries: customQueries,
    subscribe: customSubscriptions,

    // Advanced access
    collection: syncInstance?.collection || null,
    rxCollection: syncInstance?.rxCollection || null,
    replicationState: syncInstance?.replicationState || null,
    purgeStorage,
  };
}
