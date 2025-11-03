import { createCollection } from '@tanstack/react-db';
import {
  convexAutomergeCollectionOptions,
  getConvexReplicateLogger,
} from '@trestleinc/convex-replicate-core';
import { api } from '../convex/_generated/api';
import { convexClient } from './router';
import { useMemo } from 'react';

const logger = getConvexReplicateLogger(['hooks', 'useTasks']);

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

let tasksCollection: ReturnType<typeof createCollection<Task>> | null = null;

export function useTasks(initialData?: ReadonlyArray<Task>) {
  logger.debug('Hook called with initialData', { taskCount: initialData?.length ?? 0 });
  return useMemo(() => {
    if (!tasksCollection) {
      logger.debug('Creating collection with initialData', { taskCount: initialData?.length ?? 0 });
      tasksCollection = createCollection(
        convexAutomergeCollectionOptions<Task>({
          convexClient,
          api: api.tasks,
          collectionName: 'tasks',
          getKey: (task) => task.id,
          initialData,
        })
      );
    }
    return tasksCollection;
  }, [initialData]);
}
