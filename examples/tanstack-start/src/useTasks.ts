import {
  type ReactConvexRxInstance,
  createReactConvexRx,
  createLastWriteWinsHandler,
  type RxJsonSchema,
  useConvexRx,
} from '@convex-rx/react';
import React from 'react';
import { api } from '../convex/_generated/api';
import { convexClient } from './router';

// ========================================
// TASK TYPE AND SCHEMA
// ========================================

export type Task = {
  id: string;
  text: string;
  isCompleted: boolean;
  updatedTime: number;
  deleted?: boolean; // For soft deletes in RxDB
};

// RxDB schema for tasks
const taskSchema: RxJsonSchema<Task> = {
  title: 'Task Schema',
  version: 0,
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: {
      type: 'string',
      maxLength: 100,
    },
    text: {
      type: 'string',
    },
    isCompleted: {
      type: 'boolean',
    },
    updatedTime: {
      type: 'number',
      minimum: 0, // Required for number fields used in indexes
      maximum: 8640000000000000, // JavaScript Date max value
      multipleOf: 1, // Required for number fields used in indexes
    },
  },
  required: ['id', 'text', 'isCompleted', 'updatedTime'],
  indexes: [
    ['updatedTime', 'id'], // Composite index for replication checkpoints
  ],
};

// ========================================
// SYNC INSTANCE MANAGEMENT
// ========================================

let tasksSyncInstance: Promise<ReactConvexRxInstance<Task>> | null = null;
let tasksSyncInstanceResolved: ReactConvexRxInstance<Task> | null = null;

async function getTasksSync(): Promise<ReactConvexRxInstance<Task>> {
  if (tasksSyncInstanceResolved) {
    return tasksSyncInstanceResolved;
  }
  if (tasksSyncInstance) {
    return tasksSyncInstance;
  }

  tasksSyncInstance = createReactConvexRx<Task>({
    databaseName: 'taskdb',
    collectionName: 'tasks',
    schema: taskSchema,
    convexClient,
    convexApi: {
      changeStream: api.tasks.changeStream,
      pullDocuments: api.tasks.pullDocuments,
      pushDocuments: api.tasks.pushDocuments,
    },
    batchSize: 100,
    enableLogging: true,
    // Conflict resolution: last-write-wins based on updatedTime
    // This ensures the most recent change wins when conflicts occur
    conflictHandler: createLastWriteWinsHandler<Task>(),
  });
  tasksSyncInstanceResolved = await tasksSyncInstance;
  return tasksSyncInstanceResolved;
}

// ========================================
// MAIN TASKS HOOK
// ========================================

export function useTasks() {
  const [syncInstance, setSyncInstance] = React.useState<any>(null);
  const [initError, setInitError] = React.useState<string | null>(null);

  // Initialize sync instance
  React.useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const instance = await getTasksSync();
        if (mounted) {
          setSyncInstance(instance);
        }
      } catch (error) {
        if (mounted) {
          setInitError(String(error));
        }
      }
    };

    init();

    return () => {
      mounted = false;
    };
  }, []);

  // Use the generic sync hook
  const syncResult = useConvexRx<Task>(syncInstance);

  // If we're still initializing or have an error
  if (!syncInstance) {
    return {
      data: [],
      isLoading: true,
      error: initError || 'Initializing...',
      collection: null,
      actions: {
        insert: async () => {
          throw new Error('Not initialized');
        },
        update: async () => {
          throw new Error('Not initialized');
        },
        delete: async () => {
          throw new Error('Not initialized');
        },
      },
    };
  }

  return {
    ...syncResult,
    // Add task-specific helper methods if needed
    createTask: (text: string) => syncResult.actions.insert({ text, isCompleted: false }),
    toggleTask: (id: string, isCompleted: boolean) =>
      syncResult.actions.update(id, { isCompleted: !isCompleted }),
    updateTaskText: (id: string, text: string) => syncResult.actions.update(id, { text }),
    deleteTask: (id: string) => syncResult.actions.delete(id),
    purgeStorage: async () => {
      if (syncInstance) {
        try {
          console.log('[useTasks] Starting storage purge...');
          await syncInstance.cleanup();
          console.log('[useTasks] Cleanup complete, resetting singleton...');
          // Reset the singleton to allow re-initialization
          tasksSyncInstance = null;
          tasksSyncInstanceResolved = null;
          // Reload the page to reinitialize everything
          console.log('[useTasks] Reloading page...');
          window.location.reload();
        } catch (error) {
          console.error('[useTasks] Failed to purge storage:', error);
          // Even if cleanup fails, try to reset and reload
          tasksSyncInstance = null;
          tasksSyncInstanceResolved = null;
          window.location.reload();
        }
      } else {
        console.warn('[useTasks] No sync instance to purge');
      }
    },
  };
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

// Get the raw sync instance for advanced usage
export async function getTasksDatabase() {
  return getTasksSync();
}

// Clean up function for development hot reloading
if (typeof window !== 'undefined' && (import.meta as any).hot) {
  (import.meta as any).hot.dispose(() => {
    if (tasksSyncInstance) {
      tasksSyncInstance
        .then((instance) => instance.cleanup())
        .then(() => {
          tasksSyncInstance = null;
          tasksSyncInstanceResolved = null;
        })
        .catch((err) => console.error('[HMR] Cleanup failed:', err));
    }
  });
}
