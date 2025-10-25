import { createCollection } from '@tanstack/react-db';
import { convexAutomergeCollectionOptions } from '@convex-rx/core';
import { api } from '../convex/_generated/api';
import { convexClient } from './router';
import { useMemo } from 'react';

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

let tasksCollection: ReturnType<typeof createCollection<Task>> | null = null;

export function useTasks(initialData?: ReadonlyArray<Task>) {
  return useMemo(() => {
    if (!tasksCollection) {
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
