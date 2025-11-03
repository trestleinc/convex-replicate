import { createCollection } from '@tanstack/svelte-db';
import {
  convexCollectionOptions,
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
    // Type assertion needed due to contravariance issues between TanStack DB's Collection generic
    // and the ConvexCollection type. The runtime types are correct - this is a TypeScript limitation.
    tasksCollection = createCollection(
      convexCollectionOptions<Task>({
        convexClient,
        api: api.tasks,
        collectionName: 'tasks',
        getKey: (task) => task.id,
        initialData,
      })
    ) as unknown as ConvexCollection<Task>;
  }
  return tasksCollection;
}
