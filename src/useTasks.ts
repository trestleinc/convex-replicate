import React from "react";
import { createCollection } from "@tanstack/react-db";
import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection";
import { initializeDatabase, type Task } from "./database";

// Database initialization state
let dbPromise: Promise<{ db: any; replication: any }> | null = null;
let taskCollection: any = null;

// Initialize database and collection
async function initializeTaskCollection() {
  if (!dbPromise) {
    dbPromise = initializeDatabase();
  }
  
  if (!taskCollection) {
    const { db } = await dbPromise;
    
    // Create TanStack collection with RxDB integration
    taskCollection = createCollection(
      rxdbCollectionOptions({
        rxCollection: db.tasks,
        startSync: true // Start syncing immediately
      })
    );
  }
  
  return taskCollection;
}

// Hook that provides tasks using TanStack RxDB integration  
export function useTasks() {
  const [collection, setCollection] = React.useState<any>(null);
  const [data, setData] = React.useState<Task[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | undefined>(undefined);
  
  React.useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    
    const init = async () => {
      try {
        console.log('[TanStack] Initializing task collection...');
        const realCollection = await initializeTaskCollection();
        if (!mounted) return;
        
        console.log('[TanStack] Collection initialized:', realCollection);
        setCollection(realCollection);
        
        // Subscribe to collection changes using proper TanStack API
        // The callback receives no parameters - we need to access collection data directly
        unsubscribe = realCollection.subscribeChanges(() => {
          if (mounted) {
            console.log('[TanStack] Collection changed, fetching new data...');
            
            // Access the current collection data - toArray should be a method, not a property
            let tasks: Task[] = [];
            try {
              // Try different ways to access the collection data
              if (typeof realCollection.toArray === 'function') {
                tasks = realCollection.toArray();
              } else if (Array.isArray(realCollection.toArray)) {
                tasks = realCollection.toArray;
              } else if (realCollection.data && Array.isArray(realCollection.data)) {
                tasks = realCollection.data;
              } else if (realCollection.items && Array.isArray(realCollection.items)) {
                tasks = realCollection.items;
              } else {
                console.warn('[TanStack] Could not find collection data, checking collection properties:', Object.keys(realCollection));
                tasks = [];
              }
              
              console.log(`[TanStack] Found ${tasks.length} tasks:`, tasks);
              
              // Filter out deleted tasks for display
              const activeTasks = tasks.filter(task => !task._deleted);
              console.log(`[TanStack] Active tasks: ${activeTasks.length}`);
              
              setData(activeTasks);
              setIsLoading(false);
              setError(undefined);
            } catch (accessError) {
              console.error('[TanStack] Error accessing collection data:', accessError);
              setError(`Failed to access collection data: ${String(accessError)}`);
              setIsLoading(false);
            }
          }
        }, {
          includeInitialState: true // Get initial state immediately
        });
        
        console.log('[TanStack] Subscription established');
        
      } catch (initError) {
        console.error('[TanStack] Failed to initialize tasks collection:', initError);
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
        console.log('[TanStack] Cleaning up collection subscription');
        unsubscribe();
      }
    };
  }, []);

  return {
    data,
    isLoading,
    error,
    collection,
  };
}

// Hook for creating tasks
export function useCreateTask() {
  return async (taskData: { text: string }) => {
    console.log('[TanStack] Creating task:', taskData);
    
    const collection = await initializeTaskCollection();
    const taskId = crypto.randomUUID();

    const task: Task = {
      id: taskId,
      text: taskData.text,
      isCompleted: false,
      updatedTime: Date.now(),
    };

    try {
      console.log('[TanStack] Inserting task into collection:', task);
      await collection.insert(task);
      console.log('[TanStack] Task successfully created:', taskId);
      return taskId;
    } catch (error) {
      console.error('[TanStack] Failed to create task:', error);
      throw new Error(`Failed to create task: ${String(error)}`);
    }
  };
}

// Hook for updating tasks
export function useUpdateTask() {
  return async (id: string, updates: Partial<Task>) => {
    console.log('[TanStack] Updating task:', id, updates);
    
    const collection = await initializeTaskCollection();
    
    try {
      await collection.update(id, (draft: Task) => {
        console.log('[TanStack] Applying updates to draft:', draft);
        Object.assign(draft, updates, { 
          updatedTime: Date.now() 
        });
        console.log('[TanStack] Updated draft:', draft);
      });
      console.log('[TanStack] Task successfully updated:', id);
    } catch (error) {
      console.error('[TanStack] Failed to update task:', id, error);
      throw new Error(`Failed to update task ${id}: ${String(error)}`);
    }
  };
}

// Hook for deleting tasks (soft delete)
export function useDeleteTask() {
  return async (id: string) => {
    console.log('[TanStack] Deleting task (soft delete):', id);
    
    const collection = await initializeTaskCollection();
    
    try {
      await collection.update(id, (draft: Task) => {
        console.log('[TanStack] Marking task as deleted:', draft);
        draft._deleted = true;
        draft.updatedTime = Date.now();
        console.log('[TanStack] Task marked for deletion:', draft);
      });
      console.log('[TanStack] Task successfully deleted:', id);
    } catch (error) {
      console.error('[TanStack] Failed to delete task:', id, error);
      throw new Error(`Failed to delete task ${id}: ${String(error)}`);
    }
  };
}

// Utility function to get database instance
export async function getTasksDatabase() {
  if (!dbPromise) {
    dbPromise = initializeDatabase();
  }
  return dbPromise;
}

// Clean up function for development hot reloading
if (typeof window !== 'undefined' && (import.meta as any).hot) {
  (import.meta as any).hot.dispose(() => {
    if (dbPromise) {
      dbPromise.then(({ db, replication }) => {
        if (replication) {
          replication.cancel();
        }
        if (db) {
          db.destroy();
        }
      });
    }
  });
}
