import { createCollection } from "@tanstack/react-db";
import { api } from "../convex/_generated/api";
import { useLiveQuery } from "@tanstack/react-db";
import { convexCollectionOptions } from "./convexCollectionOptions";

// Task type - uses only client-side fields, ignores Convex _id
type Task = {
  id: string;
  text: string;
  isCompleted: boolean;
  updatedTime: number;
};

// Local storage utilities
const STORAGE_KEY = "tasks";

const localStorageUtils = {
  load(): Task[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error("Failed to load tasks from localStorage:", error);
      return [];
    }
  },

  save(tasks: Task[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (error) {
      console.error("Failed to save tasks to localStorage:", error);
    }
  },

  insert(newTasks: Task[]): void {
    const existing = this.load();
    const updated = [...existing, ...newTasks];
    this.save(updated);
  },

  update(updates: { key: string; changes: Partial<Task> }[]): void {
    const existing = this.load();
    const existingMap = new Map(existing.map((task: Task) => [task.id, task]));

    updates.forEach(({ key, changes }) => {
      const task = existingMap.get(key);
      if (task) {
        Object.assign(task, changes);
      }
    });

    this.save(Array.from(existingMap.values()));
  },

  delete(keysToDelete: string[]): void {
    const existing = this.load();
    const filtered = existing.filter((task: Task) => !keysToDelete.includes(task.id));
    this.save(filtered);
  },
};

// Get Convex client from the existing router setup
let convexClient: any = null;

// Simple convex client getter - will be set by the app
export const getConvexClient = () => convexClient;
export const setConvexClient = (client: any) => {
  convexClient = client;
};

// Lazy-initialized collection
let taskCollection: any = null;

// Hook that provides tasks
export function useTasks() {
  // Lazy initialize the collection
  if (!taskCollection) {
    if (!convexClient) {
      throw new Error("Convex client not initialized");
    }
    
    taskCollection = createCollection(
      convexCollectionOptions<Task>({
        convexClient,
        query: api.tasks.get,
        queryArgs: {},
        createMutation: api.tasks.create,
        updateMutation: api.tasks.update,
        // Note: no delete mutation in Convex yet
        getKey: (item) => item.id,
        convexIdField: "_id",
        syncTracking: "timestamp", // Use timestamp tracking for sync acknowledgment
        localStorageUtils, // Include localStorage utils for offline support

        // Note: onInsert, onUpdate, onDelete are handled by convexCollectionOptions
        // The collection will sync with Convex automatically
      })
    );
  }

  const { data } = useLiveQuery((q) => q.from({ task: taskCollection }));

  return {
    data: (data || []) as Task[],
    isLoading: data === undefined,
  };
}

// Hook for creating tasks
export function useCreateTask() {
  return (taskData: { text: string }) => {
    const taskId = crypto.randomUUID();

    const task: Task = {
      id: taskId,
      text: taskData.text,
      isCompleted: false,
      updatedTime: Date.now(),
    };

    try {
      taskCollection.insert(task);
      return taskId;
    } catch (error) {
      console.error("Failed to create task:", error);
      throw error;
    }
  };
}

// Hook for updating tasks
export function useUpdateTask() {
  return (id: string, updates: Partial<Task>) => {
    try {
      taskCollection.update(id, (draft: Task) => {
        Object.assign(draft, updates, { updatedTime: Date.now() });
      });
    } catch (error) {
      console.error("Failed to update task:", error);
      throw error;
    }
  };
}