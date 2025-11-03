import { createCollection } from '@tanstack/react-db';
import {
  convexCollectionOptions,
  getLogger,
  type ConvexCollection,
} from '@trestleinc/convex-replicate-core';
import { api } from '../convex/_generated/api';
import { convexClient } from './router';
import { useMemo } from 'react';

const logger = getLogger(['hooks', 'useTasks']);

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

let tasksCollection: ConvexCollection<Task>;

export function useTasks(initialData?: ReadonlyArray<Task>) {
  logger.debug('Hook called with initialData', { taskCount: initialData?.length ?? 0 });
  return useMemo(() => {
    if (!tasksCollection) {
      logger.debug('Creating collection with initialData', { taskCount: initialData?.length ?? 0 });
      tasksCollection = createCollection(
        convexCollectionOptions<Task>({
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
