import { Replicate } from '@trestleinc/replicate/server';
import { components } from './_generated/api';
import type { Task } from '../src/useTasks';

/**
 * SvelteKit Example - Tasks Collection
 *
 * This demonstrates the Replicate pattern for ConvexReplicate.
 * Create one storage instance per collection, then use factory methods to
 * generate all needed queries and mutations.
 */

// Create storage instance for 'tasks' collection
const tasksStorage = new Replicate<Task>(components.replicate, 'tasks');

/**
 * CRDT Stream Query (for real-time sync with gap detection)
 */
export const stream = tasksStorage.createStreamQuery();

/**
 * SSR Query (for server-side rendering)
 */
export const getTasks = tasksStorage.createSSRQuery();

/**
 * Insert Mutation (dual-storage)
 */
export const insertDocument = tasksStorage.createInsertMutation();

/**
 * Update Mutation (dual-storage)
 */
export const updateDocument = tasksStorage.createUpdateMutation();

/**
 * Delete Mutation (dual-storage with hard delete)
 */
export const deleteDocument = tasksStorage.createDeleteMutation();
