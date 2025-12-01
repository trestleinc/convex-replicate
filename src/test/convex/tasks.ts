import { defineReplicate } from '@trestleinc/replicate/server';
import { components } from './_generated/api';

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

export const { stream, material, insert, update, remove, protocol, compact, prune } =
  defineReplicate<Task>({
    component: components.replicate,
    collection: 'tasks',
  });
