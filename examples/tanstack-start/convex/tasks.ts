import { defineReplicate } from '@trestleinc/replicate/server';
import { components } from './_generated/api';
import type { Task } from '../src/useTasks';

/**
 * TanStack Start Example - Tasks Collection
 *
 * This demonstrates the defineReplicate builder for ConvexReplicate.
 * One-step API generation for a complete replicated collection.
 *
 * Generated exports:
 * - stream: CRDT stream query (for real-time sync with gap detection)
 * - getTasks: SSR query (materialized docs + CRDT state for initial load)
 * - insertDocument: Insert mutation (dual-storage)
 * - updateDocument: Update mutation (dual-storage)
 * - deleteDocument: Delete mutation (dual-storage with hard delete)
 * - getProtocolVersion: Protocol version query (for client compatibility)
 * - compact: Compaction mutation (for cron jobs, 90 day retention)
 * - prune: Snapshot cleanup mutation (for cron jobs, 180 day retention)
 */

export const {
  stream,
  getTasks,
  insertDocument,
  updateDocument,
  deleteDocument,
  getProtocolVersion,
  compact,
  prune,
} = defineReplicate<Task>({
  component: components.replicate,
  collection: 'tasks',
  compaction: { retentionDays: 90 },
  pruning: { retentionDays: 180 },
});
