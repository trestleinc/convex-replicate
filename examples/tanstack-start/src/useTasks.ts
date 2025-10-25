import { createCollection } from '@tanstack/react-db';
import { convexAutomergeCollectionOptions } from '@convex-rx/core';
import { api } from '../convex/_generated/api';
import { convexClient } from './router';
import { useEffect, useState } from 'react';

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

let tasksCollection: ReturnType<typeof createCollection<Task>> | null = null;

export function useTasks() {
  const [collection, setCollection] = useState<ReturnType<typeof createCollection<Task>> | null>(
    tasksCollection
  );

  useEffect(() => {
    if (!tasksCollection) {
      tasksCollection = createCollection(
        convexAutomergeCollectionOptions<Task>({
          convexClient,
          api: api.tasks,
          collectionName: 'tasks',
          getKey: (task) => task.id,
        })
      );
      setCollection(tasksCollection);
    }
  }, []);

  return collection!;
}
