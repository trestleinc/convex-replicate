import { createCollection } from '@tanstack/svelte-db';
import {
  convexCollectionOptions,
  createConvexCollection,
  type ConvexCollection,
  type Materialized,
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

export function getTasksCollection(material?: Materialized<Task>): ConvexCollection<Task> {
  if (!tasksCollection) {
    // Step 1: Create raw TanStack DB collection with ALL config
    const rawCollection = createCollection(
      convexCollectionOptions<Task>({
        convexClient,
        api: api.tasks,
        collection: 'tasks',
        getKey: (task) => task.id,
        material,
      })
    );

    // Step 2: Wrap with Convex offline support (Yjs + TanStack)
    tasksCollection = createConvexCollection(rawCollection);
  }
  return tasksCollection;
}
