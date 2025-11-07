import { createCollection } from '@tanstack/svelte-db';
import {
  convexCollectionOptions,
  createConvexCollection,
  type ConvexCollection,
} from '@trestleinc/replicate/client';
import { api } from '../../convex/_generated/api';
import { convexClient } from '../convexClient';

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

// Module-level singleton to prevent multiple collection instances
let tasksCollection: ConvexCollection<Task>;

export function getTasksCollection(initialData?: ReadonlyArray<Task>): ConvexCollection<Task> {
  if (!tasksCollection) {
    // Step 1: Create raw TanStack DB collection with ALL config
    const rawCollection = createCollection(
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
    );

    // Step 2: Wrap with Convex offline support (Yjs + TanStack)
    tasksCollection = createConvexCollection(rawCollection);
  }
  return tasksCollection;
}
