import React from 'react';
import type { ConvexReactSyncInstance } from './createConvexReactSync';

// ========================================
// TYPE DEFINITIONS
// ========================================

export interface UseConvexSyncActions<T> {
  insert: (itemData: Omit<T, 'id' | 'updatedTime' | '_deleted'>) => Promise<string>;
  update: (
    id: string,
    updates: Partial<Omit<T, 'id' | 'updatedTime' | '_deleted'>>
  ) => Promise<void>;
  delete: (id: string) => Promise<void>;
}

export interface UseConvexSyncResult<T> {
  data: T[];
  isLoading: boolean;
  error?: string;
  collection: any | null;
  actions: UseConvexSyncActions<T>;
}

// ========================================
// GENERIC CONVEX SYNC HOOK
// ========================================

/**
 * React hook for using Convex sync with TanStack DB collections.
 * Provides reactive data, loading states, and CRUD actions.
 *
 * @param syncInstance - Convex React sync instance (or null if not ready)
 * @returns Sync result with data, loading state, and action methods
 */
export function useConvexSync<T extends { id: string; updatedTime: number; _deleted?: boolean }>(
  syncInstance: ConvexReactSyncInstance<T> | null
): UseConvexSyncResult<T> {
  const [data, setData] = React.useState<T[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | undefined>(undefined);

  // Subscribe to collection changes
  React.useEffect(() => {
    if (!syncInstance) return;

    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    const init = async () => {
      try {
        const { collection } = syncInstance;
        if (!mounted) return;

        // Subscribe to collection changes using proper TanStack API
        unsubscribe = collection.subscribeChanges(
          () => {
            if (mounted) {
              // Access the current collection data
              let items: T[] = [];
              try {
                // Try different ways to access the collection data
                if (typeof collection.toArray === 'function') {
                  items = collection.toArray();
                } else if (Array.isArray(collection.toArray)) {
                  items = collection.toArray;
                } else if (collection.data && Array.isArray(collection.data)) {
                  items = collection.data;
                } else if (collection.items && Array.isArray(collection.items)) {
                  items = collection.items;
                } else {
                  items = [];
                }

                // Filter out deleted items for display
                const activeItems = items.filter((item) => !item._deleted);

                setData(activeItems);
                setIsLoading(false);
                setError(undefined);
              } catch (accessError) {
                setError(`Failed to access collection data: ${String(accessError)}`);
                setIsLoading(false);
              }
            }
          },
          {
            includeInitialState: true, // Get initial state immediately
          }
        );
      } catch (initError) {
        if (mounted) {
          setError(`Failed to initialize: ${String(initError)}`);
          setIsLoading(false);
        }
      }
    };

    init();

    return () => {
      mounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [syncInstance]);

  // Action methods
  const actions: UseConvexSyncActions<T> = React.useMemo(() => {
    if (!syncInstance) {
      // Return disabled actions if no sync instance
      return {
        async insert() {
          throw new Error('Sync not initialized');
        },
        async update() {
          throw new Error('Sync not initialized');
        },
        async delete() {
          throw new Error('Sync not initialized');
        },
      };
    }

    const { collection } = syncInstance;

    return {
      async insert(itemData: Omit<T, 'id' | 'updatedTime' | '_deleted'>) {
        const itemId = crypto.randomUUID();
        const item = {
          id: itemId,
          ...itemData,
          updatedTime: Date.now(),
        } as T;

        try {
          await collection.insert(item);
          return itemId;
        } catch (error) {
          throw new Error(`Failed to create item: ${String(error)}`);
        }
      },

      async update(id: string, updates: Partial<Omit<T, 'id' | 'updatedTime' | '_deleted'>>) {
        try {
          await collection.update(id, (draft: T) => {
            Object.assign(draft, updates, {
              updatedTime: Date.now(),
            });
          });
        } catch (error) {
          throw new Error(`Failed to update item ${id}: ${String(error)}`);
        }
      },

      async delete(id: string) {
        try {
          await collection.update(id, (draft: T) => {
            (draft as any)._deleted = true;
            (draft as any).updatedTime = Date.now();
          });
        } catch (error) {
          throw new Error(`Failed to delete item ${id}: ${String(error)}`);
        }
      },
    };
  }, [syncInstance]);

  return {
    data,
    isLoading,
    error,
    collection: syncInstance?.collection || null,
    actions,
  };
}

// ========================================
// HELPER HOOKS FOR SPECIFIC ACTIONS
// ========================================

/**
 * Hook that returns only the CRUD actions from a sync instance.
 *
 * @param syncInstance - Convex React sync instance
 * @returns Object with insert, update, and delete methods
 */
export function useConvexSyncActions<
  T extends { id: string; updatedTime: number; _deleted?: boolean },
>(syncInstance: ConvexReactSyncInstance<T> | null) {
  const { actions } = useConvexSync(syncInstance);
  return actions;
}

/**
 * Hook that returns only the data and loading states from a sync instance.
 *
 * @param syncInstance - Convex React sync instance
 * @returns Object with data, isLoading, and error
 */
export function useConvexSyncData<
  T extends { id: string; updatedTime: number; _deleted?: boolean },
>(syncInstance: ConvexReactSyncInstance<T> | null) {
  const { data, isLoading, error } = useConvexSync(syncInstance);
  return { data, isLoading, error };
}
