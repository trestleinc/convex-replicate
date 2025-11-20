import type { GenericMutationCtx, GenericQueryCtx, GenericDataModel } from 'convex/server';
import { Replicate } from './storage.js';

/**
 * defineReplicate - One-step API generation for ConvexReplicate collections
 *
 * This builder function creates a complete set of queries and mutations for a collection
 * in a single step. It internally uses the Replicate class and Effect.ts for reliability,
 * but these implementation details are hidden from the user.
 *
 * @example
 * ```typescript
 * // convex/tasks.ts
 * import { defineReplicate } from '@trestleinc/replicate/server';
 * import { components } from './_generated/api';
 * import type { Task } from '../src/useTasks';
 *
 * // ONE-STEP API generation
 * export const {
 *   stream,
 *   getTasks,
 *   insertDocument,
 *   updateDocument,
 *   deleteDocument,
 *   getProtocolVersion,
 *   compact,
 *   prune
 * } = defineReplicate<Task>({
 *   component: components.replicate,
 *   collection: 'tasks',
 *   compaction: { retentionDays: 90 },
 *   pruning: { retentionDays: 180 }
 * });
 * ```
 *
 * Or assign to a namespace:
 * ```typescript
 * export const tasks = defineReplicate<Task>({
 *   component: components.replicate,
 *   collection: 'tasks'
 * });
 * // Access as: tasks.stream, tasks.insertDocument, etc.
 * ```
 */
export function defineReplicate<T extends object>(config: {
  component: any;
  collection: string;
  compaction?: { retentionDays: number };
  pruning?: { retentionDays: number };
  migrations?: {
    schemaVersion: number;
    functions: Record<number, (doc: any) => any>;
  };
  hooks?: {
    checkRead?: (
      ctx: GenericQueryCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    checkWrite?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    checkDelete?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      docId: string
    ) => void | Promise<void>;
    onStream?: (ctx: GenericQueryCtx<GenericDataModel>, result: any) => void | Promise<void>;
    onInsert?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onUpdate?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onDelete?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
    transform?: (docs: T[]) => T[] | Promise<T[]>;
    checkCompact?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    checkPrune?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    onCompact?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
    onPrune?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
  };
}) {
  // Create storage instance with migrations if provided
  const storage = new Replicate<T>(config.component, config.collection, {
    migrations: config.migrations,
  });

  // Generate all API functions using factory methods
  return {
    // Query for CRDT stream (real-time sync)
    stream: storage.createStreamQuery({
      checkRead: config.hooks?.checkRead,
      onStream: config.hooks?.onStream,
    }),

    // Query for SSR (materialized documents)
    getTasks: storage.createSSRQuery({
      checkRead: config.hooks?.checkRead,
      transform: config.hooks?.transform,
    }),

    // Mutation for inserting documents
    insertDocument: storage.createInsertMutation({
      checkWrite: config.hooks?.checkWrite,
      onInsert: config.hooks?.onInsert,
    }),

    // Mutation for updating documents
    updateDocument: storage.createUpdateMutation({
      checkWrite: config.hooks?.checkWrite,
      onUpdate: config.hooks?.onUpdate,
    }),

    // Mutation for deleting documents
    deleteDocument: storage.createDeleteMutation({
      checkDelete: config.hooks?.checkDelete,
      onDelete: config.hooks?.onDelete,
    }),

    // Query for protocol version checking
    getProtocolVersion: storage.createProtocolVersionQuery(),

    // Mutation for compaction (cron jobs)
    compact: storage.createCompactMutation({
      retentionDays: config.compaction?.retentionDays,
      checkCompact: config.hooks?.checkCompact,
      onCompact: config.hooks?.onCompact,
    }),

    // Mutation for pruning (cron jobs)
    prune: storage.createPruneMutation({
      retentionDays: config.pruning?.retentionDays,
      checkPrune: config.hooks?.checkPrune,
      onPrune: config.hooks?.onPrune,
    }),
  };
}
