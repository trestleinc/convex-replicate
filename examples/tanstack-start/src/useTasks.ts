import { createCollection } from '@tanstack/react-db';
import { convexAutomergeCollectionOptions } from '@convex-rx/core';
import { api } from '../convex/_generated/api';
import { convexClient } from './router';

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

export const tasksCollection = createCollection(
  convexAutomergeCollectionOptions<Task>({
    convexClient,
    api: api.tasks,
    collectionName: 'tasks',
    getKey: (task) => task.id,
  })
);

export function useTasks() {
  return tasksCollection;
}
