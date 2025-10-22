/**
 * Simplified useConvexRx Hook - Effortless API
 *
 * This is the new simplified API that hides all complexity.
 * Just pass your type and table name - everything else is automatic.
 */

import type {
  ConvexClient,
  ConvexRxDocument,
  RxConflictHandler,
  RxJsonSchema,
} from '@convex-rx/core';
import React from 'react';
import { createReactConvexRx, type ReactConvexRxInstance } from './createReactConvexRx';
import { useConvexRxContextOptional } from './ConvexRxProvider';
import { useConvexRxData } from './useConvexRx';

// ========================================
// TYPES
// ========================================

export interface UseConvexRxSimpleOptions<T extends ConvexRxDocument> {
  /** Convex client (required if not using ConvexRxProvider) */
  convexClient?: ConvexClient;
  /** Database name (defaults to tableName or provider config) */
  databaseName?: string;
  /** RxDB schema (required) */
  schema: RxJsonSchema<T>;
  /** Convex API functions */
  convexApi: {
    changeStream: any;
    pullDocuments: any;
    pushDocuments: any;
  };
  /** Batch size for replication */
  batchSize?: number;
  /** Enable logging */
  enableLogging?: boolean;
  /** Conflict resolution handler */
  conflictHandler?: RxConflictHandler<T>;
}

export interface UseConvexRxSimpleActions<T> {
  /** Insert a new document */
  insert: (doc: Omit<T, 'id' | 'updatedTime'>) => Promise<string>;
  /** Update an existing document */
  update: (id: string, updates: Partial<Omit<T, 'id' | 'updatedTime'>>) => Promise<void>;
  /** Delete a document */
  delete: (id: string) => Promise<void>;
}

export interface UseConvexRxSimpleResult<T> {
  /** Array of documents */
  data: T[];
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Collection operations */
  actions: UseConvexRxSimpleActions<T>;
  /** Access to underlying TanStack collection */
  collection: any | null;
  /** Purge all local storage and reload */
  purgeStorage: () => Promise<void>;
}

// ========================================
// SINGLETON MANAGEMENT (HIDDEN FROM USER)
// ========================================

// Store singleton instances per table
const singletonInstances = new Map<
  string,
  {
    promise: Promise<ReactConvexRxInstance<any>>;
    resolved: ReactConvexRxInstance<any> | null;
  }
>();

async function getSyncInstance<T extends ConvexRxDocument>(
  tableName: string,
  options: UseConvexRxSimpleOptions<T>
): Promise<ReactConvexRxInstance<T>> {
  const key = `${options.databaseName || tableName}_${tableName}`;

  const existing = singletonInstances.get(key);
  if (existing) {
    if (existing.resolved) return existing.resolved;
    return existing.promise;
  }

  const promise = createReactConvexRx<T>({
    databaseName: options.databaseName || tableName,
    collectionName: tableName,
    schema: options.schema,
    convexClient: options.convexClient!,
    convexApi: options.convexApi,
    batchSize: options.batchSize,
    enableLogging: options.enableLogging,
    conflictHandler: options.conflictHandler,
  });

  const entry = { promise, resolved: null as ReactConvexRxInstance<T> | null };
  singletonInstances.set(key, entry);

  const resolved = await promise;
  entry.resolved = resolved;

  return resolved;
}

// ========================================
// SIMPLIFIED HOOK
// ========================================

/**
 * Effortless ConvexRx hook - just pass your type and table name!
 *
 * @example
 * ```typescript
 * type Task = { text: string; isCompleted: boolean };
 *
 * const schema = createSchema<Task>('tasks', {
 *   text: property.string(),
 *   isCompleted: property.boolean(),
 * });
 *
 * function TaskList() {
 *   const tasks = useConvexRxSimple<Task>('tasks', {
 *     schema,
 *     convexApi: {
 *       changeStream: api.tasks.changeStream,
 *       pullDocuments: api.tasks.pullDocuments,
 *       pushDocuments: api.tasks.pushDocuments,
 *     }
 *   });
 *
 *   return (
 *     <div>
 *       {tasks.isLoading && <div>Loading...</div>}
 *       {tasks.error && <div>Error: {tasks.error}</div>}
 *       {tasks.data.map(task => (
 *         <div key={task.id}>{task.text}</div>
 *       ))}
 *       <button onClick={() => tasks.actions.insert({ text: 'New task', isCompleted: false })}>
 *         Add Task
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useConvexRxSimple<T extends ConvexRxDocument>(
  tableName: string,
  options: UseConvexRxSimpleOptions<T>
): UseConvexRxSimpleResult<T> {
  // Get config from context if available
  const contextConfig = useConvexRxContextOptional();

  // Merge context config with options (options take precedence)
  const mergedOptions: UseConvexRxSimpleOptions<T> = {
    convexClient: options.convexClient || contextConfig?.convexClient,
    databaseName: options.databaseName || contextConfig?.databaseName || tableName,
    batchSize: options.batchSize ?? contextConfig?.batchSize,
    enableLogging: options.enableLogging ?? contextConfig?.enableLogging,
    conflictHandler: options.conflictHandler || contextConfig?.conflictHandler,
    schema: options.schema,
    convexApi: options.convexApi,
  };

  // Validate required config
  if (!mergedOptions.convexClient) {
    throw new Error(
      'convexClient is required. Either pass it to useConvexRxSimple or wrap your app with ConvexRxProvider.'
    );
  }

  // Initialize sync instance
  const [syncInstance, setSyncInstance] = React.useState<ReactConvexRxInstance<T> | null>(null);
  const [initError, setInitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const instance = await getSyncInstance<T>(tableName, mergedOptions);
        if (mounted) {
          setSyncInstance(instance);
          setInitError(null);
        }
      } catch (error) {
        if (mounted) {
          setInitError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    init();

    return () => {
      mounted = false;
    };
  }, [tableName]); // Only re-initialize if table name changes

  // Use the data hook
  const { data, isLoading } = useConvexRxData<T>(syncInstance);

  // Provide actions
  const actions = React.useMemo(() => {
    if (!syncInstance) {
      return {
        insert: async () => {
          throw new Error('Not initialized');
        },
        update: async () => {
          throw new Error('Not initialized');
        },
        delete: async () => {
          throw new Error('Not initialized');
        },
      };
    }

    return {
      insert: async (doc: Omit<T, 'id' | 'updatedTime'>) => {
        const id = crypto.randomUUID();
        const fullDoc = {
          ...doc,
          id,
          updatedTime: Date.now(),
        } as T;
        await syncInstance.collection.insert(fullDoc);
        return id;
      },
      update: async (id: string, updates: Partial<Omit<T, 'id' | 'updatedTime'>>) => {
        await syncInstance.collection.update(id, (draft: any) => {
          Object.assign(draft, updates);
          draft.updatedTime = Date.now();
        });
      },
      delete: async (id: string) => {
        await syncInstance.collection.update(id, (draft: any) => {
          draft._deleted = true;
          draft.updatedTime = Date.now();
        });
      },
    };
  }, [syncInstance]);

  // Purge storage function
  const purgeStorage = React.useCallback(async () => {
    if (syncInstance) {
      try {
        await syncInstance.cleanup();
        // Reset singleton
        const key = `${mergedOptions.databaseName}_${tableName}`;
        singletonInstances.delete(key);
        // Reload page
        window.location.reload();
      } catch (error) {
        console.error('Failed to purge storage:', error);
        // Try to reload anyway
        window.location.reload();
      }
    }
  }, [syncInstance, tableName, mergedOptions.databaseName]);

  return {
    data,
    isLoading: !syncInstance || isLoading,
    error: initError,
    actions,
    collection: syncInstance?.collection || null,
    purgeStorage,
  };
}
