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
  stream, // CRDT stream query (for real-time sync with gap detection)
  getTasks, // SSR query (for server-side rendering)
  insertDocument, // Insert mutation (dual-storage)
  updateDocument, // Update mutation (dual-storage)
  deleteDocument, // Delete mutation (dual-storage with hard delete)
  getProtocolVersion, // Protocol version query
  compact, // Compaction mutation (for cron jobs)
  prune, // Snapshot cleanup mutation (for cron jobs)
} = defineReplicate<Task>({
  component: components.replicate,
  collection: 'tasks',
  compaction: { retentionDays: 90 },
  pruning: { retentionDays: 180 },
});
