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
  createInitializationError,
  ErrorSeverity,
  RecoveryStrategy,
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
    // Individual context properties instead of entire object
    contextConfig.convexClient,
    contextConfig.databaseName,
    contextConfig.batchSize,
    contextConfig.enableLogging,
    contextConfig.conflictHandler,
  ]);

  // ========================================
  // 2. INITIALIZE DATABASE INSTANCE (SINGLETON)
  // ========================================

  const [database, setDatabase] = React.useState<Awaited<
    ReturnType<typeof createConvexRx<TData>>
  > | null>(null);
  const [initError, setInitError] = React.useState<ReturnType<
    typeof createInitializationError
  > | null>(null);

  React.useEffect(() => {
    const abortController = new AbortController();

    const init = async () => {
      try {
        const instance = await getSingletonInstance(mergedConfig, {
          keyFn: (cfg) => createSingletonKey(cfg.databaseName, cfg.collectionName),
          createFn: createConvexRx,
        });

        if (!abortController.signal.aborted) {
          setDatabase(instance);
          setInitError(null);
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          setInitError(
            createInitializationError({
              message: error instanceof Error ? error.message : String(error),
              severity: ErrorSeverity.FATAL,
              recovery: RecoveryStrategy.MANUAL,
              phase: 'database',
              databaseName: mergedConfig.databaseName,
              collectionName: mergedConfig.collectionName,
              cause: error,
            })
          );
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

  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
  const [isReplicating, setIsSyncing] = React.useState(false);

  React.useEffect(() => {
    if (!database) return;

    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    const logger = getLogger(config.table, mergedConfig.enableLogging ?? false);

    const subscribe = () => {
      try {
        const { collection } = database;

        subscription = collection.subscribeChanges(
          () => {
            if (!mounted) return;
            logger.debug('Collection changed, triggering re-render');
            forceUpdate();
          },
          {
            includeInitialState: true,
          }
        );
      } catch (subscribeError) {
        if (mounted) {
          logger.error('Failed to subscribe', { error: subscribeError });
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
  }, [database, config.table, mergedConfig.enableLogging]);

  // ========================================
  // 3B. TRACK BACKGROUND SYNC STATE
  // ========================================

  React.useEffect(() => {
    if (!database) return;

    const { replicationState } = database;

    // Subscribe to replication active state
    const subscription = replicationState.active$.subscribe((isActive) => {
      setIsSyncing(isActive);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [database]);

  // ========================================
  // 4. CREATE BASE ACTIONS
  // ========================================

  const baseActions = React.useMemo<BaseActions<TData>>(() => {
    if (!database) {
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

    const { collection, rxCollection } = database;

    // Use core action factory with TanStack DB collection wrapper
    return createBaseActions<TData>({
      rxCollection,
      insertFn: async (doc) => {
        collection.insert(doc);
      },
      updateFn: async (id, updater) => {
        // Type assertion needed for TanStack DB's update signature (WritableDeep compatibility)
        collection.update(id, updater as any);
      },
    });
  }, [database]);

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
    if (!database || !config.middleware?.onSyncError) return;

    const cleanup = setupSyncErrorMiddleware(database.replicationState, config.middleware);

    return cleanup; // No need for null check - always returns a function
  }, [database, config.middleware]);

  // ========================================
  // 7. BUILD EXTENSION CONTEXT
  // ========================================

  const extensionContext = React.useMemo<HookContext<TData> | null>(() => {
    if (!database) return null;

    return {
      collection: database.collection,
      rxCollection: database.rxCollection,
      database: database.database,
      replicationState: database.replicationState,
    };
  }, [database]);

  // ========================================
  // 8. BUILD MERGED ACTIONS (BASE + CUSTOM)
  // ========================================

  const mergedActions = React.useMemo<BaseActions<TData> & TActions>(() => {
    if (!config.actions || !extensionContext) {
      // Return only base actions if no custom actions
      return wrappedActions as BaseActions<TData> & TActions;
    }

    // Merge base actions with custom actions
    const customActions = config.actions(wrappedActions, extensionContext);
    return { ...wrappedActions, ...customActions };
  }, [config.actions, wrappedActions, extensionContext, config]);

  // ========================================
  // 9. BUILD CUSTOM QUERIES
  // ========================================

  const customQueries = React.useMemo<TQueries>(() => {
    if (!config.queries || !extensionContext) {
      return {} as TQueries;
    }

    return config.queries(extensionContext);
  }, [config.queries, extensionContext, config]);

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
    if (!database) return;

    try {
      await database.cleanup();
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
    database,
    mergedConfig.databaseName,
    mergedConfig.collectionName,
    config.table,
    mergedConfig.enableLogging,
  ]);

  // ========================================
  // 12. RETURN UNIFIED RESULT
  // ========================================

  // Derive data from collection instead of duplicating in state
  const data = database
    ? database.collection.toArray.filter((item) => !item._deleted)
    : config.initialData || [];

  // Consolidated status object
  const isReady = database?.collection.isReady() ?? false;
  const status = {
    isLoading: !isReady,
    isReady,
    isReplicating,
    error: initError,
  };

  return {
    // Data
    data,

    // Status
    status,

    // Actions (base + custom)
    actions: mergedActions,

    // Queries and subscriptions
    queries: customQueries,
    subscribe: customSubscriptions,

    // Advanced access
    collection: database?.collection || null,
    rxCollection: database?.rxCollection || null,
    replicationState: database?.replicationState || null,
    purgeStorage,
  };
}
