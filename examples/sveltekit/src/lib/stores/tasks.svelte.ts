import { createCollection } from '@tanstack/svelte-db';
import {
  convexCollectionOptions,
  createConvexCollection,
  getLogger,
  type ConvexCollection,
} from '@trestleinc/convex-replicate-core';
import { api } from '../../convex/_generated/api';
import { convexClient } from '../convexClient';

const logger = getLogger(['stores', 'tasks']);

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

let tasksCollection: ConvexCollection<Task>;

export function getTasksCollection(initialData?: ReadonlyArray<Task>): ConvexCollection<Task> {
  if (!tasksCollection) {
    logger.debug('Creating tasks collection', { taskCount: initialData?.length ?? 0 });

    // Step 1: Create raw TanStack DB collection with ALL config (0.3.0 API)
    const rawCollection = createCollection(
      convexCollectionOptions<Task>({
        convexClient,
        api: api.tasks,
        collectionName: 'tasks',
        getKey: (task) => task.id,
        initialData,
      })
    );

    // Step 2: Wrap with Convex offline support - params automatically extracted!
    tasksCollection = createConvexCollection(rawCollection as any) as ConvexCollection<Task>;
  }
  return tasksCollection;
}
