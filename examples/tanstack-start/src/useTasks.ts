import { createCollection } from '@tanstack/react-db';
import {
  convexCollectionOptions,
  createConvexCollection,
  type ConvexCollection,
} from '@trestleinc/replicate/client';
import { api } from '../convex/_generated/api';
import { convexClient } from './router';
import { useMemo } from 'react';

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

let tasksCollection: ConvexCollection<Task> | null = null;

export function useTasks(initialData?: ReadonlyArray<Task>) {
  return useMemo(() => {
    // Force recreation to pick up code changes (temporary fix for HMR)
    tasksCollection = null;

    if (!tasksCollection) {
      // Step 1: Create raw collection with ALL config (params only passed once!)
      tasksCollection = createConvexCollection(
        createCollection(
          convexCollectionOptions<Task>({
            convexClient,
            api: {
              stream: api.tasks.stream,
              insertDocument: api.tasks.insertDocument,
              updateDocument: api.tasks.updateDocument,
              deleteDocument: api.tasks.deleteDocument,
              getProtocolVersion: api.replicate.getProtocolVersion,
            },
            collection: 'tasks',
            getKey: (task) => task.id,
            initialData,
          })
        )
      );
    }
    return tasksCollection;
  }, [initialData]);
}
