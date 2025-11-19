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
  // biome-ignore lint/correctness/useExhaustiveDependencies: initialData only used on first render - DO NOT add to deps as it would recreate Y.Doc and corrupt CRDT state
  return useMemo(() => {
    // Create singleton collection - persist across renders to maintain Y.Doc state
    // DO NOT force recreation as it creates new Y.Doc instances causing CRDT state corruption
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
            ssrQuery: api.tasks.getTasks, // For reconciliation - ensures deleted items are removed
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
  }, []); // Empty deps - only create once per session to prevent Y.Doc recreation
}
