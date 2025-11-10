import { v } from 'convex/values';
import type { GenericMutationCtx, GenericQueryCtx, GenericDataModel } from 'convex/server';
import { queryGeneric, mutationGeneric } from 'convex/server';

/**
 * ReplicateStorage - Type-safe wrapper for ConvexReplicate component operations
 *
 * This class provides factory methods to generate Convex queries and mutations
 * that interact with the replicate component for a specific collection.
 *
 * Pattern inspired by convex-helpers/r2 component.
 *
 * @example
 * ```typescript
 * import { ReplicateStorage } from '@trestleinc/replicate/server';
 * import { components } from './_generated/api';
 * import type { Task } from '../src/useTasks';
 *
 * // Create storage (compaction runs via daily cron job)
 * const tasksStorage = new ReplicateStorage<Task>(
 *   components.replicate,
 *   'tasks',
 *   { compactionCutoffDays: 90 } // Optional: customize cutoff (default: 90 days)
 * );
 *
 * export const streamCRDT = tasksStorage.createStreamQuery();
 * export const getTasks = tasksStorage.createSSRQuery();
 * export const insertDocument = tasksStorage.createInsertMutation();
 * ```
 */
export class ReplicateStorage<T extends object> {
  constructor(
    public component: any, // components.replicate from _generated/api
    public collectionName: string,
    public options?: {
      compactionCutoffDays?: number; // How old deltas must be for compaction (default: 90)
    }
  ) {}

  /**
   * Creates a stream query for CRDT sync with gap detection support.
   *
   * This query calls the replicate component's stream function, which returns
   * CRDT deltas for incremental synchronization. Supports gap detection via
   * state vectors and checkpoints.
   *
   * @param opts - Optional hooks for permissions and lifecycle
   * @returns Convex query function
   */
  createStreamQuery(opts?: {
    checkRead?: (
      ctx: GenericQueryCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    onStream?: (ctx: GenericQueryCtx<GenericDataModel>, result: any) => void | Promise<void>;
  }) {
    const component = this.component;
    const collection = this.collectionName;

    return queryGeneric({
      args: {
        checkpoint: v.object({ lastModified: v.number() }),
        limit: v.optional(v.number()),
      },
      returns: v.object({
        changes: v.array(
          v.object({
            documentId: v.string(),
            crdtBytes: v.bytes(),
            version: v.number(),
            timestamp: v.number(),
          })
        ),
        checkpoint: v.object({ lastModified: v.number() }),
        hasMore: v.boolean(),
      }),
      handler: async (ctx, args) => {
        // Permission check hook
        if (opts?.checkRead) {
          await opts.checkRead(ctx, collection);
        }

        // Call component for CRDT bytes (NOT main table)
        const result = await ctx.runQuery(component.public.stream, {
          collection,
          checkpoint: args.checkpoint,
          limit: args.limit,
        });

        // Lifecycle hook
        if (opts?.onStream) {
          await opts.onStream(ctx, result);
        }

        return result;
      },
    });
  }

  /**
   * Creates an SSR query for materialized documents.
   *
   * This query fetches documents directly from the main application table,
   * returning plain JSON objects suitable for server-side rendering.
   * Does NOT include CRDT bytes.
   *
   * @param opts - Optional hooks for permissions and transformation
   * @returns Convex query function
   */
  createSSRQuery(opts?: {
    checkRead?: (
      ctx: GenericQueryCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    transform?: (docs: T[]) => T[] | Promise<T[]>;
  }) {
    const collection = this.collectionName;

    return queryGeneric({
      args: {},
      returns: v.any(), // Array of materialized documents
      handler: async (ctx) => {
        // Permission check hook
        if (opts?.checkRead) {
          await opts.checkRead(ctx, collection);
        }

        // Query main table for materialized documents
        let docs = (await ctx.db.query(collection).collect()) as T[];

        // Optional transformation (e.g., filtering, sorting)
        if (opts?.transform) {
          docs = await opts.transform(docs);
        }

        return docs;
      },
    });
  }

  /**
   * Creates an insert mutation for dual-storage architecture.
   *
   * Writes to BOTH:
   * 1. Component storage (CRDT bytes for conflict resolution)
   * 2. Main application table (materialized doc for efficient queries)
   *
   * @param opts - Optional hooks for permissions and lifecycle
   * @returns Convex mutation function
   */
  createInsertMutation(opts?: {
    checkWrite?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onInsert?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
  }) {
    const component = this.component;
    const collection = this.collectionName;

    return mutationGeneric({
      args: {
        documentId: v.string(),
        crdtBytes: v.bytes(),
        materializedDoc: v.any(),
        version: v.number(),
      },
      returns: v.object({
        success: v.boolean(),
        metadata: v.any(),
      }),
      handler: async (ctx, args) => {
        const doc = args.materializedDoc as T;

        // Permission check hook
        if (opts?.checkWrite) {
          await opts.checkWrite(ctx, doc);
        }

        // 1. Write CRDT bytes to component (event sourcing)
        await ctx.runMutation(component.public.insertDocument, {
          collection,
          documentId: args.documentId,
          crdtBytes: args.crdtBytes,
          version: args.version,
        });

        // 2. Write materialized doc to main table
        await ctx.db.insert(collection, {
          id: args.documentId,
          ...args.materializedDoc,
          version: args.version,
          timestamp: Date.now(),
        });

        // Lifecycle hook
        if (opts?.onInsert) {
          await opts.onInsert(ctx, doc);
        }

        return {
          success: true,
          metadata: {
            documentId: args.documentId,
            timestamp: Date.now(),
            version: args.version,
            collection,
          },
        };
      },
    });
  }

  /**
   * Creates an update mutation for dual-storage architecture.
   *
   * Updates BOTH:
   * 1. Component storage (appends new CRDT delta)
   * 2. Main application table (patches materialized doc)
   *
   * @param opts - Optional hooks for permissions and lifecycle
   * @returns Convex mutation function
   */
  createUpdateMutation(opts?: {
    checkWrite?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onUpdate?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
  }) {
    const component = this.component;
    const collection = this.collectionName;

    return mutationGeneric({
      args: {
        documentId: v.string(),
        crdtBytes: v.bytes(),
        materializedDoc: v.any(),
        version: v.number(),
      },
      returns: v.object({
        success: v.boolean(),
        metadata: v.any(),
      }),
      handler: async (ctx, args) => {
        const doc = args.materializedDoc as T;

        // Permission check hook
        if (opts?.checkWrite) {
          await opts.checkWrite(ctx, doc);
        }

        // 1. Append CRDT delta to component (event sourcing)
        await ctx.runMutation(component.public.updateDocument, {
          collection,
          documentId: args.documentId,
          crdtBytes: args.crdtBytes,
          version: args.version,
        });

        // 2. Update materialized doc in main table
        const existing = await ctx.db
          .query(collection)
          .filter((q) => q.eq(q.field('id'), args.documentId))
          .first();

        if (existing) {
          await ctx.db.patch(existing._id, {
            ...args.materializedDoc,
            version: args.version,
            timestamp: Date.now(),
          });
        }

        // Lifecycle hook
        if (opts?.onUpdate) {
          await opts.onUpdate(ctx, doc);
        }

        return {
          success: true,
          metadata: {
            documentId: args.documentId,
            timestamp: Date.now(),
            version: args.version,
            collection,
          },
        };
      },
    });
  }

  /**
   * Creates a delete mutation for dual-storage architecture.
   *
   * Deletes from BOTH:
   * 1. Component storage (appends delete delta to event log)
   * 2. Main application table (hard delete - physically removes doc)
   *
   * @param opts - Optional hooks for permissions and lifecycle
   * @returns Convex mutation function
   */
  createDeleteMutation(opts?: {
    checkDelete?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      docId: string
    ) => void | Promise<void>;
    onDelete?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
  }) {
    const component = this.component;
    const collection = this.collectionName;

    return mutationGeneric({
      args: {
        documentId: v.string(),
        crdtBytes: v.bytes(),
        version: v.number(),
      },
      returns: v.object({
        success: v.boolean(),
        metadata: v.any(),
      }),
      handler: async (ctx, args) => {
        // Permission check hook
        if (opts?.checkDelete) {
          await opts.checkDelete(ctx, args.documentId);
        }

        // 1. Append delete delta to component (preserves history)
        await ctx.runMutation(component.public.deleteDocument, {
          collection,
          documentId: args.documentId,
          crdtBytes: args.crdtBytes,
          version: args.version,
        });

        // 2. Hard delete from main table
        const existing = await ctx.db
          .query(collection)
          .filter((q) => q.eq(q.field('id'), args.documentId))
          .first();

        if (existing) {
          await ctx.db.delete(existing._id);
        }

        // Lifecycle hook
        if (opts?.onDelete) {
          await opts.onDelete(ctx, args.documentId);
        }

        return {
          success: true,
          metadata: {
            documentId: args.documentId,
            timestamp: Date.now(),
            version: args.version,
            collection,
          },
        };
      },
    });
  }
}
