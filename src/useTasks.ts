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
  
  React.useEffect(() => {
    let mounted = true;
    
    const init = async () => {
      try {
        const realCollection = await initializeTaskCollection();
        if (!mounted) return;
        
        setCollection(realCollection);
        
        // Subscribe to collection changes using proper TanStack API
        const unsubscribe = realCollection.subscribeChanges(() => {
          if (mounted) {
            const tasks = realCollection.toArray as Task[];
            setData(tasks);
            setIsLoading(false);
          }
        }, {
          includeInitialState: true // Get initial state immediately
        });
        
        return unsubscribe;
      } catch (error) {
        console.error("Failed to initialize tasks collection:", error);
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    
    init();
    
    return () => {
      mounted = false;
    };
  }, []);

  return {
    data,
    isLoading,
    error: undefined, // RxDB errors are handled internally
    collection,
  };
}

// Hook for creating tasks
export function useCreateTask() {
  return async (taskData: { text: string }) => {
    const collection = await initializeTaskCollection();
    const taskId = crypto.randomUUID();

    const task: Task = {
      id: taskId,
      text: taskData.text,
      isCompleted: false,
      updatedTime: Date.now(),
    };

    try {
      await collection.insert(task);
      return taskId;
    } catch (error) {
      console.error("Failed to create task:", error);
      throw error;
    }
  };
}

// Hook for updating tasks
export function useUpdateTask() {
  return async (id: string, updates: Partial<Task>) => {
    const collection = await initializeTaskCollection();
    
    try {
      await collection.update(id, (draft: Task) => {
        Object.assign(draft, updates, { 
          updatedTime: Date.now() 
        });
      });
    } catch (error) {
      console.error("Failed to update task:", error);
      throw error;
    }
  };
}

// Hook for deleting tasks (soft delete)
export function useDeleteTask() {
  return async (id: string) => {
    const collection = await initializeTaskCollection();
    
    try {
      await collection.update(id, (draft: Task) => {
        draft._deleted = true;
        draft.updatedTime = Date.now();
      });
    } catch (error) {
      console.error("Failed to delete task:", error);
      throw error;
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
