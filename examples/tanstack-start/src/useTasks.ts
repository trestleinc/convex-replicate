import { createCollection } from '@tanstack/react-db';
import {
  convexCollectionOptions,
  handleReconnect,
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
      // Layer 3: TanStack DB (reactive queries)
      // Layer 2: Yjs + IndexedDB (source of truth) - configured via convexCollectionOptions
      const rawCollection = createCollection(
        convexCollectionOptions<Task>({
          convexClient,
          api: {
            stream: api.tasks.stream,
            insertDocument: api.tasks.insertDocument,
            updateDocument: api.tasks.updateDocument,
            deleteDocument: api.tasks.deleteDocument,
            getProtocolVersion: api.tasks.getProtocolVersion,
          },
          collection: 'tasks',
          getKey: (task) => task.id,
          initialData,
        })
      );

      // Layer 1: Offline reconnect (retry layer)
      tasksCollection = handleReconnect(rawCollection);
    }
    return tasksCollection;
  }, [initialData]);
}
