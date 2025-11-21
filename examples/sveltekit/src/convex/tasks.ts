import { defineReplicate } from '@trestleinc/replicate/server';
import { components } from './_generated/api';
import type { Task } from '../src/useTasks';

/**
 * SvelteKit Example - Tasks Collection
 *
 * Uses defineReplicate for one-step API generation.
 * This automatically creates all needed queries and mutations.
 */

export const {
  stream, // CRDT stream query (for real-time sync with difference detection)
  material, // SSR query (for server-side rendering)
  insert, // Insert mutation (dual-storage)
  update, // Update mutation (dual-storage)
  remove, // Remove mutation (dual-storage with hard delete)
  protocol, // Protocol version query
  compact, // Compaction mutation (for cron jobs)
  prune, // Snapshot cleanup mutation (for cron jobs)
} = defineReplicate<Task>({
  component: components.replicate,
  collection: 'tasks',
  compaction: { retention: 90 },
  pruning: { retention: 180 },
});
