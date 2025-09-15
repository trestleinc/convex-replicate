import React from "react";

// ========================================
// TYPE DEFINITIONS
// ========================================

interface SyncInstance<T> {
  collection: any; // TanStack collection
  database: any;
  rxCollection: any;
  replicationState: any;
  tableName: string;
}

interface UseConvexSyncActions<T> {
  insert: (itemData: Omit<T, 'id' | 'updatedTime' | '_deleted'>) => Promise<string>;
  update: (id: string, updates: Partial<Omit<T, 'id' | 'updatedTime' | '_deleted'>>) => Promise<void>;
  delete: (id: string) => Promise<void>;
}

interface UseConvexSyncResult<T> {
  data: T[];
  isLoading: boolean;
  error?: string;
  collection: any | null;
  actions: UseConvexSyncActions<T>;
}

// ========================================
// GENERIC CONVEX SYNC HOOK
// ========================================

export function useConvexSync<T extends { id: string; updatedTime: number; _deleted?: boolean }>(
  syncInstance: SyncInstance<T> | null
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
        const tableName = syncInstance.tableName;
        console.log(`[${tableName}] Initializing TanStack collection...`);
        
        const { collection } = syncInstance;
        if (!mounted) return;
        
        console.log(`[${tableName}] TanStack collection initialized`);
        
        // Subscribe to collection changes using proper TanStack API
        unsubscribe = collection.subscribeChanges(() => {
          if (mounted) {
            console.log(`[${tableName}] Collection changed, fetching new data...`);
            
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
                console.warn(`[${tableName}] Could not find collection data, checking collection properties:`, Object.keys(collection));
                items = [];
              }
              
              console.log(`[${tableName}] Found ${items.length} items`);
              
              // Filter out deleted items for display
              const activeItems = items.filter(item => !item._deleted);
              console.log(`[${tableName}] Active items: ${activeItems.length}`);
              
              setData(activeItems);
              setIsLoading(false);
              setError(undefined);
            } catch (accessError) {
              console.error(`[${tableName}] Error accessing collection data:`, accessError);
              setError(`Failed to access collection data: ${String(accessError)}`);
              setIsLoading(false);
            }
          }
        }, {
          includeInitialState: true // Get initial state immediately
        });
        
        console.log(`[${tableName}] Subscription established`);
        
      } catch (initError) {
        console.error(`[${syncInstance.tableName}] Failed to initialize:`, initError);
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
        console.log(`[${syncInstance.tableName}] Cleaning up subscription`);
        unsubscribe();
      }
    };
  }, [syncInstance]);

  // Action methods
  const actions: UseConvexSyncActions<T> = React.useMemo(() => {
    if (!syncInstance) {
      // Return disabled actions if no sync instance
      return {
        async insert() { throw new Error('Sync not initialized'); },
        async update() { throw new Error('Sync not initialized'); },
        async delete() { throw new Error('Sync not initialized'); }
      };
    }

    const { collection, tableName } = syncInstance;

    return {
      async insert(itemData: Omit<T, 'id' | 'updatedTime' | '_deleted'>) {
        console.log(`[${tableName}] Creating item:`, itemData);
        
        const itemId = crypto.randomUUID();
        const item = {
          id: itemId,
          ...itemData,
          updatedTime: Date.now(),
        } as T;

        try {
          console.log(`[${tableName}] Inserting item into collection:`, item);
          await collection.insert(item);
          console.log(`[${tableName}] Item successfully created:`, itemId);
          return itemId;
        } catch (error) {
          console.error(`[${tableName}] Failed to create item:`, error);
          throw new Error(`Failed to create item: ${String(error)}`);
        }
      },

      async update(id: string, updates: Partial<Omit<T, 'id' | 'updatedTime' | '_deleted'>>) {
        console.log(`[${tableName}] Updating item:`, id, updates);
        
        try {
          await collection.update(id, (draft: T) => {
            console.log(`[${tableName}] Applying updates to draft:`, draft);
            Object.assign(draft, updates, { 
              updatedTime: Date.now() 
            });
            console.log(`[${tableName}] Updated draft:`, draft);
          });
          console.log(`[${tableName}] Item successfully updated:`, id);
        } catch (error) {
          console.error(`[${tableName}] Failed to update item:`, id, error);
          throw new Error(`Failed to update item ${id}: ${String(error)}`);
        }
      },

      async delete(id: string) {
        console.log(`[${tableName}] Deleting item (soft delete):`, id);
        
        try {
          await collection.update(id, (draft: T) => {
            console.log(`[${tableName}] Marking item as deleted:`, draft);
            (draft as any)._deleted = true;
            (draft as any).updatedTime = Date.now();
            console.log(`[${tableName}] Item marked for deletion:`, draft);
          });
          console.log(`[${tableName}] Item successfully deleted:`, id);
        } catch (error) {
          console.error(`[${tableName}] Failed to delete item:`, id, error);
          throw new Error(`Failed to delete item ${id}: ${String(error)}`);
        }
      }
    };
  }, [syncInstance]);

  return {
    data,
    isLoading,
    error,
    collection: syncInstance?.collection || null,
    actions
  };
}

// ========================================
// HELPER HOOKS FOR SPECIFIC ACTIONS
// ========================================

export function useConvexSyncActions<T extends { id: string; updatedTime: number; _deleted?: boolean }>(
  syncInstance: SyncInstance<T> | null
) {
  const { actions } = useConvexSync(syncInstance);
  return actions;
}

export function useConvexSyncData<T extends { id: string; updatedTime: number; _deleted?: boolean }>(
  syncInstance: SyncInstance<T> | null
) {
  const { data, isLoading, error } = useConvexSync(syncInstance);
  return { data, isLoading, error };
}