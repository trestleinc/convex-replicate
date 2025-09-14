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
  
  // Client configuration for reconnection
  convexUrl?: string;
  onClientReplaced?: (newClient: ConvexReactClient) => void;
  
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
  getOfflineQueue: () => OfflineMutation[];
  clearOfflineQueue: () => void;
  goOffline: () => Promise<void>;
  goOnline: () => Promise<void>;
  isConnected: () => boolean;
  refreshFromServer: () => Promise<void>;
}

type OfflineMutation = {
  id: string;
  type: 'insert' | 'update' | 'delete';
  data: any;
  timestamp: number;
  retries: number;
};

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
  
  // Connection state tracking for reconnection detection
  let lastConnectionCount = 0;
  let connectionStateUnsubscribe: (() => void) | null = null;
  
  // Track current client for replacement
  let currentClient = config.convexClient;
  let isManuallyOffline = false;
  
  // Store sync parameters for watchQuery setup
  let syncParams: any = null;
  
  // Helper function to setup watchQuery subscription (reusable for reconnection)
  const setupWatchQuery = () => {
    if (!syncParams) {
      console.error("Cannot setup watchQuery: sync parameters not available");
      return;
    }
    
    if (unsubscribe) {
      // Clean up existing subscription
      unsubscribe();
      unsubscribe = null;
    }
    
    console.log("Setting up real-time subscription to Convex");
    const { begin, write, commit, getOperationType, eventBuffer } = syncParams;
    const watch = currentClient.watchQuery(config.query, config.queryArgs || {});
    
    const unsubscribeFn = watch.onUpdate(() => {
      const data = watch.localQueryResult();
      if (!data) return;
      
      // Buffer events during initial sync
      if (!isInitialSyncComplete) {
        // Store as buffer to process after initial sync
        const existingIds = new Set(eventBuffer.map((e: { type: "insert" | "update" | "delete"; value: TItem }) => 
          config.getKey(e.value)
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
  };
  
  // Offline queue management  
  const OFFLINE_QUEUE_KEY = `offline_mutations_${config.id || 'default'}`;
  
  const offlineQueue = {
    load(): OfflineMutation[] {
      try {
        const stored = localStorage.getItem(OFFLINE_QUEUE_KEY);
        return stored ? JSON.parse(stored) : [];
      } catch (error) {
        console.error("Failed to load offline queue:", error);
        return [];
      }
    },
    
    save(mutations: OfflineMutation[]): void {
      try {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(mutations));
      } catch (error) {
        console.error("Failed to save offline queue:", error);
      }
    },
    
    add(mutation: OfflineMutation): void {
      const existing = this.load();
      existing.push(mutation);
      this.save(existing);
    },
    
    clear(): void {
      localStorage.removeItem(OFFLINE_QUEUE_KEY);
    }
  };
  
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
    
    // Store sync parameters for watchQuery setup
    syncParams = { begin, write, commit, collection, getOperationType, eventBuffer };
    
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
    setupWatchQuery();
    
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
        const initialData = await currentClient.query(
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
    
    // Set up connection state monitoring for reconnection detection
    connectionStateUnsubscribe = currentClient.subscribeToConnectionState((connState) => {
      const currentConnectionCount = connState.connectionCount;
      
      // Detect reconnection (connectionCount increased)
      if (currentConnectionCount > lastConnectionCount && lastConnectionCount > 0) {
        console.log("Reconnection detected, processing offline queue...");
        void processOfflineQueue();
      }
      
      lastConnectionCount = currentConnectionCount;
    });
    
    // Process any existing offline queue on startup
    void processOfflineQueue();
    
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
      
      // Cleanup connection state monitoring
      if (connectionStateUnsubscribe) {
        connectionStateUnsubscribe();
        connectionStateUnsubscribe = null;
      }
    };
  };
  
  // Process offline queue - retry failed mutations when connection is restored
  const processOfflineQueue = async (): Promise<void> => {
    const queuedMutations = offlineQueue.load();
    if (queuedMutations.length === 0) {
      return;
    }
    
    console.log(`Processing ${queuedMutations.length} offline mutations...`);
    const successfulMutations: string[] = [];
    
    for (const mutation of queuedMutations) {
      try {
        // Retry the mutation based on its type
        switch (mutation.type) {
          case 'insert':
            await currentClient.mutation(config.createMutation, mutation.data);
            break;
          case 'update':
            await currentClient.mutation(config.updateMutation, mutation.data);
            break;
          case 'delete':
            if (config.deleteMutation) {
              await currentClient.mutation(config.deleteMutation, { id: mutation.data.id });
            }
            break;
        }
        
        successfulMutations.push(mutation.id);
        console.log(`Successfully synced offline ${mutation.type} mutation:`, mutation.id);
        
      } catch (error) {
        console.error(`Failed to sync offline ${mutation.type} mutation:`, mutation.id, error);
        
        // Increment retry count and remove if too many failures
        mutation.retries++;
        if (mutation.retries >= 3) {
          console.warn(`Giving up on offline mutation after 3 retries:`, mutation.id);
          successfulMutations.push(mutation.id); // Remove from queue
        }
      }
    }
    
    // Remove successful mutations from queue
    if (successfulMutations.length > 0) {
      const remainingMutations = queuedMutations.filter(m => !successfulMutations.includes(m.id));
      offlineQueue.save(remainingMutations);
      console.log(`Removed ${successfulMutations.length} processed mutations from offline queue`);
      
      // After successful sync, refresh collection from server to ensure server authority
      try {
        await refreshFromServer();
        console.log("Collection refreshed from server after offline sync");
      } catch (error) {
        console.error("Failed to refresh collection after offline sync:", error);
      }
    }
  };
  
  // Connection control methods
  const goOffline = async (): Promise<void> => {
    console.log("Going offline - closing WebSocket connection...");
    isManuallyOffline = true;
    
    // Stop real-time subscription to prevent overriding local changes
    if (unsubscribe) {
      console.log("Stopping real-time subscription to allow local-only updates");
      unsubscribe();
      unsubscribe = null;
    }
    
    // Close current client connection
    await currentClient.close();
    
    // Clean up connection state subscription
    if (connectionStateUnsubscribe) {
      connectionStateUnsubscribe();
      connectionStateUnsubscribe = null;
    }
  };
  
  const goOnline = async (): Promise<void> => {
    console.log("Going online - establishing new WebSocket connection...");
    isManuallyOffline = false;
    
    if (!config.convexUrl) {
      console.error("Cannot reconnect: convexUrl not provided in config");
      return;
    }
    
    // Create new client instance
    const newClient = new ConvexReactClient(config.convexUrl);
    currentClient = newClient;
    
    // Notify parent component about client replacement
    if (config.onClientReplaced) {
      config.onClientReplaced(newClient);
    }
    
    // Re-establish real-time subscription with new client
    setupWatchQuery();
    
    // Re-establish connection state monitoring
    connectionStateUnsubscribe = currentClient.subscribeToConnectionState((connState) => {
      const currentConnectionCount = connState.connectionCount;
      
      // Detect reconnection (connectionCount increased) 
      if (currentConnectionCount > lastConnectionCount && lastConnectionCount > 0) {
        console.log("Reconnection detected, processing offline queue...");
        void processOfflineQueue();
      }
      
      lastConnectionCount = currentConnectionCount;
    });
    
    // Process offline queue immediately after reconnection
    void processOfflineQueue();
  };
  
  const isConnected = (): boolean => {
    if (isManuallyOffline) {
      return false;
    }
    return currentClient.connectionState().isWebSocketConnected;
  };
  
  // Collection refresh method to reload from server (ensures server authority)
  const refreshFromServer = async (): Promise<void> => {
    console.log("Refreshing collection from server to ensure authority...");
    
    try {
      // Fetch latest data from server
      const serverData = await currentClient.query(
        config.query,
        config.queryArgs || {}
      );
      
      if (serverData && Array.isArray(serverData)) {
        // Clear localStorage to remove any stale offline data
        if (config.localStorageUtils) {
          config.localStorageUtils.save([]);
        }
        
        // TODO: We need access to the sync params to refresh the collection
        // This will be called from processOfflineQueue after successful sync
        // The collection will be refreshed via the real-time subscription
        console.log(`Server refresh: Found ${serverData.length} items from server`);
        
        // Update localStorage with fresh server data
        if (config.localStorageUtils) {
          const clientData = serverData.map((item: ConvexItem) => stripConvexFields<TItem>(item));
          config.localStorageUtils.save(clientData);
        }
        
        // The real-time subscription will automatically update the collection
        // when the server data changes, so we don't need to manually write to collection here
      }
    } catch (error) {
      console.error("Failed to refresh collection from server:", error);
      throw error;
    }
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
    console.log("onInsert called with", transaction.mutations.length, "mutations, connected:", isConnected());
    
    // First, persist locally if localStorage utils are provided
    if (config.localStorageUtils) {
      const newItems = transaction.mutations
        .filter((m) => m.type === "insert")
        .map((m) => m.modified);
      config.localStorageUtils.insert(newItems);
      console.log("Persisted", newItems.length, "items to localStorage");
    }
    
    // Handle server sync (skip if offline, queue for later)
    const shouldSync = isConnected();
    
    if (!shouldSync) {
      console.log("Offline mode: Adding insert mutations to offline queue");
      
      try {
        // Add mutations to offline queue when disconnected (synchronous operation)
        for (const mutation of transaction.mutations) {
          if (mutation.type === "insert") {
            const offlineMutation: OfflineMutation = {
              id: crypto.randomUUID(),
              type: 'insert',
              data: mutation.modified,
              timestamp: mutationTime,
              retries: 0
            };
            offlineQueue.add(offlineMutation);
          }
        }
        console.log("Offline mutations queued successfully");
      } catch (error) {
        console.error("Failed to queue offline mutations:", error);
        // Don't throw - still allow optimistic updates
      }
      
      // Return success immediately - don't block optimistic updates
      console.log("onInsert returning success for offline mode");
      return { refetch: false };
    }
    
    try {
      // Process all insert mutations in the transaction
      for (const mutation of transaction.mutations) {
        if (mutation.type === "insert") {
          // Pass all data including the client-side ID to Convex
          await currentClient.mutation(config.createMutation, mutation.modified);
        }
      }
      
      // Wait for the data to sync back
      if (config.syncTracking === "timestamp") {
        await awaitSync(mutationTime);
      }
      
      return { refetch: false };
    } catch (error) {
      console.error("Failed to sync insert to Convex, adding to offline queue:", error);
      
      // Add failed mutations to offline queue for retry on reconnection
      for (const mutation of transaction.mutations) {
        if (mutation.type === "insert") {
          const offlineMutation: OfflineMutation = {
            id: crypto.randomUUID(),
            type: 'insert',
            data: mutation.modified,
            timestamp: mutationTime,
            retries: 0
          };
          offlineQueue.add(offlineMutation);
        }
      }
      
      // Don't throw - allow optimistic update to persist locally
      return { refetch: false };
    }
  };
  
  const onUpdate = async ({ transaction }: UpdateMutationFnParams<TItem>) => {
    const mutationTime = Date.now();
    console.log("onUpdate called with", transaction.mutations.length, "mutations, connected:", isConnected());
    
    // First, persist locally if localStorage utils are provided
    if (config.localStorageUtils) {
      const updates = transaction.mutations
        .filter((m) => m.type === "update")
        .map((m) => ({
          key: config.getKey(m.original as TItem) as string,
          changes: m.changes as Partial<TItem>,
        }));
      config.localStorageUtils.update(updates);
      console.log("Persisted", updates.length, "updates to localStorage");
    }
    
    // Handle server sync (skip if offline, queue for later)
    const shouldSync = isConnected();
    
    if (!shouldSync) {
      console.log("Offline mode: Adding update mutations to offline queue");
      
      try {
        // Add mutations to offline queue when disconnected (synchronous operation)
        for (const mutation of transaction.mutations) {
          if (mutation.type === "update") {
            const localId = config.getKey(mutation.original);
            const offlineMutation: OfflineMutation = {
              id: crypto.randomUUID(),
              type: 'update',
              data: {
                id: localId,
                ...mutation.changes,
              },
              timestamp: mutationTime,
              retries: 0
            };
            offlineQueue.add(offlineMutation);
          }
        }
        console.log("Offline mutations queued successfully");
      } catch (error) {
        console.error("Failed to queue offline mutations:", error);
        // Don't throw - still allow optimistic updates
      }
      
      // Return success immediately - don't block optimistic updates
      console.log("onUpdate returning success for offline mode");
      return { refetch: false };
    }
    
    try {
      // Process all update mutations in the transaction
      for (const mutation of transaction.mutations) {
        if (mutation.type === "update") {
          // For updates, we need to use the local ID since Convex tracks by local ID
          const localId = config.getKey(mutation.original);
          
          await currentClient.mutation(config.updateMutation, {
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
      console.error("Failed to sync update to Convex, adding to offline queue:", error);
      
      // Add failed mutations to offline queue for retry on reconnection
      for (const mutation of transaction.mutations) {
        if (mutation.type === "update") {
          const localId = config.getKey(mutation.original);
          const offlineMutation: OfflineMutation = {
            id: crypto.randomUUID(),
            type: 'update',
            data: {
              id: localId,
              ...mutation.changes,
            },
            timestamp: mutationTime,
            retries: 0
          };
          offlineQueue.add(offlineMutation);
        }
      }
      
      // Don't throw - allow optimistic update to persist locally
      return { refetch: false };
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
      getOfflineQueue: () => offlineQueue.load(),
      clearOfflineQueue: () => offlineQueue.clear(),
      goOffline,
      goOnline,
      isConnected,
      refreshFromServer,
    },
  };
}