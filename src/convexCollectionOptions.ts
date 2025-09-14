import type {
  CollectionConfig,
  SyncConfig,
  InsertMutationFnParams,
  UpdateMutationFnParams,
  DeleteMutationFnParams,
  UtilsRecord,
} from "@tanstack/db";
import { ConvexReactClient } from "convex/react";
import { FunctionReference } from "convex/server";

// Convex-specific collection configuration
interface ConvexCollectionConfig<TItem extends object>
  extends Omit<CollectionConfig<TItem>, "onInsert" | "onUpdate" | "onDelete" | "sync"> {
  // Convex client instance
  convexClient: ConvexReactClient;
  
  // Convex query function to subscribe to
  query: FunctionReference<"query">;
  queryArgs?: Record<string, any>;
  
  // Convex mutation functions
  createMutation: FunctionReference<"mutation">;
  updateMutation: FunctionReference<"mutation">;
  deleteMutation?: FunctionReference<"mutation">;
  
  // Field to use as the Convex ID (typically "_id")
  convexIdField?: string;
  
  // Sync tracking method
  syncTracking?: "timestamp" | "id";
  
  // Optional localStorage utils for offline support
  localStorageUtils?: {
    load: () => TItem[];
    save: (items: TItem[]) => void;
    insert: (items: TItem[]) => void;
    update: (updates: { key: string; changes: Partial<TItem> }[]) => void;
    delete: (keys: string[]) => void;
  };
}

interface ConvexCollectionUtils extends UtilsRecord {
  getLastSyncTime: () => number;
  awaitSync: (afterTime: number) => Promise<void>;
}

type ConvexItem = {
  _id: string;
  _creationTime: number;
  [key: string]: any;
};

// Helper function to strip Convex fields and keep only client-side fields
function stripConvexFields<TItem>(item: ConvexItem): TItem {
  const { _id, _creationTime, ...clientFields } = item;
  return clientFields as TItem;
}

export function convexCollectionOptions<TItem extends object>(
  config: ConvexCollectionConfig<TItem>
): CollectionConfig<TItem> & { utils: ConvexCollectionUtils } {
  const convexIdField = config.convexIdField || "_id";
  
  // Track sync state
  let lastSyncTime = 0;
  let syncWatchers: Array<() => void> = [];
  let unsubscribe: (() => void) | null = null;
  
  // Track pending mutations for acknowledgment
  const pendingMutations = new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    timestamp: number;
  }>();
  
  // Buffer for events during initial sync
  const eventBuffer: Array<{ type: "insert" | "update" | "delete"; value: TItem }> = [];
  let isInitialSyncComplete = false;
  
  const sync: SyncConfig<TItem>["sync"] = (params) => {
    const { begin, write, commit, markReady, collection } = params;
    
    // Helper to determine operation type using TanStack DB Collection API
    const getOperationType = (item: TItem): "insert" | "update" => {
      const key = config.getKey(item);
      return collection.has(key) ? "update" : "insert";
    };
    
    // Helper to process buffered events
    const processBufferedEvents = () => {
      if (eventBuffer.length > 0) {
        begin();
        for (const event of eventBuffer) {
          // Re-determine operation type since collection state may have changed
          const operationType = getOperationType(event.value);
          write({ type: operationType, value: event.value });
        }
        commit();
        eventBuffer.length = 0;
      }
    };
    
    // Subscribe to real-time updates FIRST (prevents race conditions)
    const watch = config.convexClient.watchQuery(config.query, config.queryArgs || {});
    
    const unsubscribeFn = watch.onUpdate(() => {
      const data = watch.localQueryResult();
      if (!data) return;
      
      // Buffer events during initial sync
      if (!isInitialSyncComplete) {
        // Store as buffer to process after initial sync
        const existingIds = new Set(eventBuffer.map(e => 
          (e.value as any)[config.getKey(e.value as TItem)]
        ));
        
        for (const item of data) {
          const clientItem = stripConvexFields<TItem>(item);
          const key = config.getKey(clientItem);
          if (!existingIds.has(key)) {
            const operationType = getOperationType(clientItem);
            eventBuffer.push({ type: operationType, value: clientItem });
            existingIds.add(key);
          }
        }
        return;
      }
      
      // Process real-time updates after initial sync
      // We need to be smarter about this to avoid overwriting optimistic updates
      // For now, we'll rely on the timestamp tracking to prevent overwrites
      begin();
      
      // Write data with correct operation type based on existence in collection
      const clientItems = data.map((item: ConvexItem) => stripConvexFields<TItem>(item));
      for (const clientItem of clientItems) {
        const operationType = getOperationType(clientItem);
        write({ type: operationType, value: clientItem });
      }
      
      commit();
      
      // Update localStorage with the latest data
      if (config.localStorageUtils) {
        config.localStorageUtils.save(clientItems);
      }
      
      // Update sync time and notify watchers
      lastSyncTime = Date.now();
      syncWatchers.forEach(notify => notify());
      syncWatchers = [];
    });
    
    // Set up unsubscribe function
    unsubscribe = unsubscribeFn;
    
    // Perform initial data fetch
    async function initialSync() {
      try {
        // First, load from localStorage if available (for offline support)
        if (config.localStorageUtils) {
          const localData = config.localStorageUtils.load();
          if (localData.length > 0) {
            begin();
            for (const item of localData) {
              write({ type: "insert", value: item });
            }
            commit();
          }
        }
        
        // Then fetch from Convex to get the latest data
        const initialData = await config.convexClient.query(
          config.query,
          config.queryArgs || {}
        );
        
        if (initialData && Array.isArray(initialData)) {
          begin();
          
          for (const item of initialData) {
            const clientItem = stripConvexFields<TItem>(item);
            const operationType = getOperationType(clientItem);
            write({ type: operationType, value: clientItem });
          }
          
          commit();
          
          // Update localStorage with fresh data if available
          if (config.localStorageUtils) {
            const clientData = initialData.map((item: ConvexItem) => stripConvexFields<TItem>(item));
            config.localStorageUtils.save(clientData);
          }
        }
        
        // Mark initial sync as complete and process buffered events
        isInitialSyncComplete = true;
        processBufferedEvents();
        
        // Update sync time
        lastSyncTime = Date.now();
        
      } catch (error) {
        console.error("Initial Convex sync failed:", error);
        // Don't throw if we have local data
        if (!config.localStorageUtils || config.localStorageUtils.load().length === 0) {
          throw error;
        }
      } finally {
        // Always call markReady, even on error
        markReady();
      }
    }
    
    // Start initial sync
    initialSync();
    
    // Return cleanup function
    return () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      
      // Clear pending mutations
      pendingMutations.forEach(({ timeout, reject }) => {
        clearTimeout(timeout);
        reject(new Error("Collection sync stopped"));
      });
      pendingMutations.clear();
    };
  };
  
  // Helper to wait for sync after a specific time
  const awaitSync = (afterTime: number): Promise<void> => {
    if (lastSyncTime > afterTime) {
      return Promise.resolve();
    }
    
    return new Promise((resolve) => {
      const checkSync = () => {
        if (lastSyncTime > afterTime) {
          resolve();
        }
      };
      syncWatchers.push(checkSync);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        const index = syncWatchers.indexOf(checkSync);
        if (index > -1) {
          syncWatchers.splice(index, 1);
          resolve(); // Resolve anyway to prevent hanging
        }
      }, 10000);
    });
  };
  
  // Mutation handlers that wait for sync acknowledgment
  const onInsert = async ({ transaction }: InsertMutationFnParams<TItem>) => {
    const mutationTime = Date.now();
    
    // First, persist locally if localStorage utils are provided
    if (config.localStorageUtils) {
      const newItems = transaction.mutations
        .filter((m) => m.type === "insert")
        .map((m) => m.modified);
      config.localStorageUtils.insert(newItems);
    }
    
    try {
      // Process all insert mutations in the transaction
      for (const mutation of transaction.mutations) {
        if (mutation.type === "insert") {
          // Pass all data including the client-side ID to Convex
          await config.convexClient.mutation(config.createMutation, mutation.modified);
        }
      }
      
      // Wait for the data to sync back
      if (config.syncTracking === "timestamp") {
        await awaitSync(mutationTime);
      }
      
      return { refetch: false };
    } catch (error) {
      console.error("Failed to sync insert to Convex:", error);
      throw error;
    }
  };
  
  const onUpdate = async ({ transaction }: UpdateMutationFnParams<TItem>) => {
    const mutationTime = Date.now();
    
    // First, persist locally if localStorage utils are provided
    if (config.localStorageUtils) {
      const updates = transaction.mutations
        .filter((m) => m.type === "update")
        .map((m) => ({
          key: config.getKey(m.original as TItem) as string,
          changes: m.changes as Partial<TItem>,
        }));
      config.localStorageUtils.update(updates);
    }
    
    try {
      // Process all update mutations in the transaction
      for (const mutation of transaction.mutations) {
        if (mutation.type === "update") {
          // For updates, we need to use the local ID since Convex tracks by local ID
          const localId = config.getKey(mutation.original);
          
          await config.convexClient.mutation(config.updateMutation, {
            id: localId,
            ...mutation.changes,
          });
        }
      }
      
      // Wait for the data to sync back
      if (config.syncTracking === "timestamp") {
        await awaitSync(mutationTime);
      }
      
      return { refetch: false };
    } catch (error) {
      console.error("Failed to sync update to Convex:", error);
      throw error;
    }
  };
  
  const onDelete = config.deleteMutation
    ? async ({ transaction }: DeleteMutationFnParams<TItem>) => {
        const mutationTime = Date.now();
        
        try {
          // Process all delete mutations in the transaction
          for (const mutation of transaction.mutations) {
            if (mutation.type === "delete") {
              const convexId = (mutation.original as any)[convexIdField];
              
              if (convexId && config.deleteMutation) {
                await config.convexClient.mutation(config.deleteMutation, {
                  id: convexId,
                });
              }
            }
          }
          
          // Wait for the data to sync back
          if (config.syncTracking === "timestamp") {
            await awaitSync(mutationTime);
          }
          
          return { refetch: false };
        } catch (error) {
          console.error("Failed to sync delete to Convex:", error);
          throw error;
        }
      }
    : undefined;
  
  return {
    id: config.id,
    schema: config.schema,
    getKey: config.getKey,
    sync: { sync },
    onInsert,
    onUpdate,
    onDelete,
    utils: {
      getLastSyncTime: () => lastSyncTime,
      awaitSync,
    },
  };
}