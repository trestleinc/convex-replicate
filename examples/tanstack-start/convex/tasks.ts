import { defineReplicate } from '@trestleinc/replicate/server';
import { components } from './_generated/api';
import type { Task } from '../src/useTasks';

export const { stream, material, insert, update, remove, protocol, compact, prune } =
  defineReplicate<Task>({
    component: components.replicate,
    collection: 'tasks',
    compaction: { retention: 90 },
    pruning: { retention: 180 },
  });
