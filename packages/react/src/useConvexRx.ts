import React from 'react';
import type { ConvexReactSyncInstance } from './createConvexReactSync';

// ========================================
// TYPE DEFINITIONS
// ========================================

export interface UseConvexRxActions<T> {
  insert: (itemData: Omit<T, 'id' | 'updatedTime' | 'deleted'>) => Promise<string>;
  update: (
    id: string,
    updates: Partial<Omit<T, 'id' | 'updatedTime' | 'deleted'>>
  ) => Promise<void>;
  delete: (id: string) => Promise<void>;
}

export interface UseConvexRxResult<T> {
  data: T[];
  isLoading: boolean;
  error?: string;
  collection: any | null;
  rxCollection: any | null;
  actions: UseConvexRxActions<T>;
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
export function useConvexRx<T extends { id: string; updatedTime: number; deleted?: boolean }>(
  syncInstance: ConvexReactSyncInstance<T> | null
): UseConvexRxResult<T> {
  const [data, setData] = React.useState<T[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | undefined>(undefined);

  // Subscribe to collection changes
  React.useEffect(() => {
    if (!syncInstance) return;

    let mounted = true;
    let unsubscribe: any;

    const init = async () => {
      try {
        const { collection } = syncInstance;
        if (!mounted) return;

        // Subscribe to collection changes using proper TanStack API
        // subscribeChanges returns a CollectionSubscription object with an unsubscribe method
        unsubscribe = collection.subscribeChanges(
          () => {
            if (mounted) {
              try {
                // toArray is a getter (not a method) - access as property
                const items: T[] = collection.toArray;

                console.log('[useConvexRx] TanStack DB collection items:', items);

                // Filter out soft-deleted items (_deleted: true)
                const activeItems = items.filter((item: any) => !item._deleted);

                console.log('[useConvexRx] Active items after filtering:', activeItems);
                console.log(
                  '[useConvexRx] Filtered out deleted items:',
                  items.filter((item: any) => item._deleted)
                );

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
  const actions: UseConvexRxActions<T> = React.useMemo(() => {
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

    const { collection, rxCollection } = syncInstance;

    return {
      async insert(itemData: Omit<T, 'id' | 'updatedTime' | 'deleted'>) {
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

      async update(id: string, updates: Partial<Omit<T, 'id' | 'updatedTime' | 'deleted'>>) {
        try {
          const tx = collection.update(id, (draft) => {
            Object.assign(draft, updates, {
              updatedTime: Date.now(),
            });
          });
          await tx.isPersisted.promise;
        } catch (error) {
          throw new Error(`Failed to update item ${id}: ${String(error)}`);
        }
      },

      async delete(id: string) {
        try {
          console.log(`[useConvexRx] Deleting item with id: ${id}`);

          // Use RxDB collection directly for soft delete
          // Explicitly set _deleted: true instead of using remove()
          const doc = await rxCollection.findOne(id).exec();

          console.log(`[useConvexRx] Found document for deletion:`, doc?.toJSON());

          if (doc) {
            // Explicitly set _deleted: true using update() to ensure it's synced
            // doc.remove() doesn't always set _deleted properly when using TanStack DB wrapper
            await doc.update({
              $set: {
                _deleted: true,
                updatedTime: Date.now(),
              },
            });
            console.log(`[useConvexRx] Document marked as deleted (_deleted: true)`);
          } else {
            throw new Error(`Item ${id} not found`);
          }
        } catch (error) {
          console.error(`[useConvexRx] Delete error:`, error);
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
    rxCollection: syncInstance?.rxCollection || null,
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
export function useConvexRxActions<
  T extends { id: string; updatedTime: number; deleted?: boolean },
>(syncInstance: ConvexReactSyncInstance<T> | null) {
  const { actions } = useConvexRx(syncInstance);
  return actions;
}

/**
 * Hook that returns only the data and loading states from a sync instance.
 *
 * @param syncInstance - Convex React sync instance
 * @returns Object with data, isLoading, and error
 */
export function useConvexRxData<T extends { id: string; updatedTime: number; deleted?: boolean }>(
  syncInstance: ConvexReactSyncInstance<T> | null
) {
  const { data, isLoading, error } = useConvexRx(syncInstance);
  return { data, isLoading, error };
}
