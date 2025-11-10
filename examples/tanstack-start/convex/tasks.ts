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

// Create storage instance for 'tasks' collection
const tasksStorage = new Replicate<Task>(components.replicate, 'tasks');

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
 * Compaction Mutation (for cron jobs)
 *
 * Compacts CRDT deltas older than 90 days into efficient snapshots.
 * Call this from a cron job (see convex/crons.ts).
 */
export const compact = tasksStorage.createCompactMutation({ retentionDays: 90 });

/**
 * Prune Mutation (for cron jobs)
 *
 * Deletes snapshots older than 180 days (keeps 2 most recent per collection).
 * Call this from a cron job (see convex/crons.ts).
 */
export const prune = tasksStorage.createPruneMutation({ retentionDays: 180 });
