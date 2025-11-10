import { Replicate } from '@trestleinc/replicate/server';
import { components } from './_generated/api';
import type { Task } from '../src/useTasks';

/**
 * TanStack Start Example - Tasks Collection
 *
 * This demonstrates the Replicate pattern for ConvexReplicate.
 * Create one storage instance per collection, then use factory methods to
 * generate all needed queries and mutations.
 */

// Create storage instance for 'tasks' collection with automatic compaction
const tasksStorage = new Replicate<Task>(components.replicate, 'tasks', {
  compactInterval: 1440,          // Run compaction every 24 hours
  compactRetention: 129600,       // Compact deltas older than 90 days
  pruneInterval: 10080,           // Run pruning every 7 days
  pruneRetention: 259200,         // Delete snapshots older than 180 days
});

/**
 * CRDT Stream Query (for real-time sync with gap detection)
 *
 * This query is used by the client for ongoing synchronization.
 * It returns CRDT bytes from the component, supporting:
 * - State vectors for efficient diffing
 * - Checkpoints for incremental sync
 * - Gap detection when deltas are compacted
 */
export const stream = tasksStorage.createStreamQuery();

/**
 * SSR Query (for server-side rendering)
 *
 * This query returns materialized JSON documents from the main table.
 * Used for initial page load to provide fast SSR hydration.
 * Does NOT include CRDT bytes - just plain objects.
 */
export const getTasks = tasksStorage.createSSRQuery();

/**
 * Insert Mutation (dual-storage)
 *
 * Writes to BOTH:
 * 1. Component (CRDT bytes for conflict resolution)
 * 2. Main table (materialized doc for efficient queries)
 */
export const insertDocument = tasksStorage.createInsertMutation();

/**
 * Update Mutation (dual-storage)
 *
 * Updates BOTH:
 * 1. Component (appends new CRDT delta)
 * 2. Main table (patches materialized doc)
 */
export const updateDocument = tasksStorage.createUpdateMutation();

/**
 * Delete Mutation (dual-storage with hard delete)
 *
 * Deletes from BOTH:
 * 1. Component (appends delete delta to event log - history preserved)
 * 2. Main table (hard delete - physically removes document)
 */
export const deleteDocument = tasksStorage.createDeleteMutation();

/**
 * Protocol Version Query
 *
 * Returns the current protocol version from the replicate component.
 * Used by clients to check compatibility and trigger protocol migrations.
 */
export const getProtocolVersion = tasksStorage.createProtocolVersionQuery();

/**
 * Schedule Initialization Mutation (one-time setup)
 *
 * Registers compaction and pruning schedules based on constructor options.
 * Call this once after installing the replicate component:
 *
 * ```
 * await ctx.runMutation(api.tasks.initSchedule);
 * ```
 *
 * This will register:
 * - Compaction every 24 hours (compacts deltas older than 129600 minutes / 90 days)
 * - Pruning every 7 days (deletes snapshots older than 259200 minutes / 180 days)
 */
export const initSchedule = tasksStorage.createScheduleInit();
