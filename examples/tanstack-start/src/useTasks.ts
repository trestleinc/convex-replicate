import { createCollection } from '@tanstack/react-db';
import {
  convexCollectionOptions,
  handleReconnect,
  type ConvexCollection,
  type Materialized,
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

export function useTasks(material?: Materialized<Task>) {
  return useMemo(() => {
    if (!tasksCollection) {
      tasksCollection = handleReconnect(
        createCollection(
          convexCollectionOptions<Task>({
            convexClient,
            api: api.tasks,
            collection: 'tasks',
            getKey: (task) => task.id,
            material,
          })
        )
      );
    }
    return tasksCollection;
  }, [material]);
}
