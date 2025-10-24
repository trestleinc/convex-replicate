import { useConvexReplicate } from '@convex-rx/react';
import { components } from '../convex/_generated/api';

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

export function useTasks() {
  return useConvexReplicate<Task>({
    collectionName: 'tasks',
    api: components.storage.public,
    enableLogging: false,
  });
}
