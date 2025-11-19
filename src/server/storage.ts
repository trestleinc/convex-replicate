import { v } from 'convex/values';
import type { GenericMutationCtx, GenericQueryCtx, GenericDataModel } from 'convex/server';
import { queryGeneric, mutationGeneric, internalMutationGeneric } from 'convex/server';

/**
 * Replicate - Type-safe wrapper for ConvexReplicate component operations
 *
 * This class provides factory methods to generate Convex queries and mutations
 * that interact with the replicate component for a specific collection.
 *
 * Pattern inspired by convex-helpers/r2 component.
 *
 * @example
 * ```typescript
 * import { Replicate } from '@trestleinc/replicate/server';
 * import { components } from './_generated/api';
 * import type { Task } from '../src/useTasks';
 *
 * // Create storage instance for 'tasks' collection
 * const tasksStorage = new Replicate<Task>(components.replicate, 'tasks');
 *
 * export const stream = tasksStorage.createStreamQuery();
 * export const getTasks = tasksStorage.createSSRQuery();
 * export const insertDocument = tasksStorage.createInsertMutation();
 * export const compact = tasksStorage.createCompactMutation({ retentionDays: 90 });
 * export const prune = tasksStorage.createPruneMutation({ retentionDays: 180 });
 * ```
 */
export class Replicate<T extends object> {
  constructor(
    public component: any, // components.replicate from _generated/api
    public collectionName: string,
    public options?: {
      migrations?: {
        schemaVersion: number; // Server schema version
        functions: Record<number, (doc: any) => any>; // Version -> migration function
      };
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
        vector: v.optional(v.bytes()),
      },
      returns: v.object({
        changes: v.array(
          v.object({
            documentId: v.optional(v.string()),
            crdtBytes: v.bytes(),
            version: v.number(),
            timestamp: v.number(),
            operationType: v.string(),
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
          vector: args.vector,
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
   * Optionally includes checkpoint information for efficient CRDT sync.
   *
   * @param opts - Optional hooks for permissions, transformation, and metadata
   * @returns Convex query function
   */
  createSSRQuery(opts?: {
    checkRead?: (
      ctx: GenericQueryCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    transform?: (docs: T[]) => T[] | Promise<T[]>;
    includeMetadata?: boolean; // Include checkpoint and count information
    includeCRDTState?: boolean; // Include CRDT bytes for Yjs initialization
  }) {
    const collection = this.collectionName;
    const component = this.component;

    return queryGeneric({
      args: {},
      returns:
        opts?.includeMetadata || opts?.includeCRDTState
          ? v.object({
              documents: v.any(),
              checkpoint: v.optional(v.object({ lastModified: v.number() })),
              count: v.number(),
              crdtBytes: v.optional(v.bytes()), // CRDT state for Yjs initialization
            })
          : v.any(), // Backward compatible: just array of documents
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

        // If metadata or CRDT state requested, build enhanced response
        if (opts?.includeMetadata || opts?.includeCRDTState) {
          const latestTimestamp =
            docs.length > 0 ? Math.max(...docs.map((doc: any) => doc.timestamp || 0)) : 0;

          const response: {
            documents: T[];
            checkpoint?: { lastModified: number };
            count: number;
            crdtBytes?: ArrayBuffer;
          } = {
            documents: docs,
            checkpoint: latestTimestamp > 0 ? { lastModified: latestTimestamp } : undefined,
            count: docs.length,
          };

          // Fetch CRDT state from component if requested
          if (opts?.includeCRDTState) {
            const crdtState = await ctx.runQuery(component.public.getInitialState, {
              collection,
            });

            if (crdtState) {
              response.crdtBytes = crdtState.crdtBytes;
              // Use component checkpoint if available (more accurate)
              response.checkpoint = crdtState.checkpoint;
            }
          }

          return response;
        }

        // Backward compatible: just return array
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
    const hasMigrations = !!this.options?.migrations;

    return mutationGeneric({
      args: hasMigrations
        ? {
            documentId: v.string(),
            crdtBytes: v.bytes(),
            materializedDoc: v.any(),
            version: v.number(),
            _schemaVersion: v.optional(v.number()),
          }
        : {
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
        let doc = args.materializedDoc as T;

        // Permission check hook
        if (opts?.checkWrite) {
          await opts.checkWrite(ctx, doc);
        }

        // Migration step (if configured and client provided version)
        if (
          hasMigrations &&
          args._schemaVersion !== undefined &&
          args._schemaVersion !== null &&
          typeof args._schemaVersion === 'number'
        ) {
          const targetVersion = this.options?.migrations?.schemaVersion;
          if (targetVersion && args._schemaVersion < targetVersion) {
            doc = this.migrate(doc, args._schemaVersion) as T;
            args.materializedDoc = doc;
          }
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
          ...(args.materializedDoc as object),
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
    const hasMigrations = !!this.options?.migrations;

    return mutationGeneric({
      args: hasMigrations
        ? {
            documentId: v.string(),
            crdtBytes: v.bytes(),
            materializedDoc: v.any(),
            version: v.number(),
            _schemaVersion: v.optional(v.number()),
          }
        : {
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
        let doc = args.materializedDoc as T;

        // Permission check hook
        if (opts?.checkWrite) {
          await opts.checkWrite(ctx, doc);
        }

        // Migration step (if configured and client provided version)
        if (
          hasMigrations &&
          args._schemaVersion !== undefined &&
          args._schemaVersion !== null &&
          typeof args._schemaVersion === 'number'
        ) {
          const targetVersion = this.options?.migrations?.schemaVersion;
          if (targetVersion && args._schemaVersion < targetVersion) {
            doc = this.migrate(doc, args._schemaVersion) as T;
            args.materializedDoc = doc;
          }
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
            ...(args.materializedDoc as object),
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
    const hasMigrations = !!this.options?.migrations;

    return mutationGeneric({
      args: hasMigrations
        ? {
            documentId: v.string(),
            crdtBytes: v.bytes(),
            version: v.number(),
            _schemaVersion: v.optional(v.number()),
          }
        : {
            documentId: v.string(),
            crdtBytes: v.bytes(),
            version: v.number(),
          },
      returns: v.object({
        success: v.boolean(),
        metadata: v.any(),
      }),
      handler: async (ctx, args) => {
        const documentId = args.documentId as string;

        // Permission check hook
        if (opts?.checkDelete) {
          await opts.checkDelete(ctx, documentId);
        }

        // Note: No migration needed for deletes (document is being removed)
        // but we accept _schemaVersion for API consistency

        // 1. Append delete delta to component (preserves history)
        await ctx.runMutation(component.public.deleteDocument, {
          collection,
          documentId: documentId,
          crdtBytes: args.crdtBytes,
          version: args.version,
        });

        // 2. Hard delete from main table
        const existing = await ctx.db
          .query(collection)
          .filter((q) => q.eq(q.field('id'), documentId))
          .first();

        if (existing) {
          await ctx.db.delete(existing._id);
        }

        // Lifecycle hook
        if (opts?.onDelete) {
          await opts.onDelete(ctx, documentId);
        }

        return {
          success: true,
          metadata: {
            documentId: documentId,
            timestamp: Date.now(),
            version: args.version,
            collection,
          },
        };
      },
    });
  }

  /**
   * Private helper to migrate a document through multiple schema versions.
   *
   * Applies migration functions sequentially from the client's version
   * to the server's current version.
   *
   * @param doc - Document to migrate
   * @param fromVersion - Client's schema version
   * @returns Migrated document
   */
  private migrate(doc: any, fromVersion: number): any {
    if (!this.options?.migrations) {
      return doc;
    }

    let currentDoc = doc;
    const targetVersion = this.options.migrations.schemaVersion;

    // Apply migrations sequentially (e.g., v1→v2→v3)
    for (let v = fromVersion + 1; v <= targetVersion; v++) {
      const migrationFn = this.options.migrations.functions[v];
      if (!migrationFn) {
        throw new Error(
          `No migration function defined for ${this.collectionName} version ${v}. ` +
            `Required to migrate from v${fromVersion} to v${targetVersion}.`
        );
      }
      currentDoc = migrationFn(currentDoc);
    }

    return currentDoc;
  }

  /**
   * Creates a query to fetch the protocol version from the component.
   * This wrapper is required for the client to check protocol compatibility.
   *
   * @returns Convex query function
   */
  createProtocolVersionQuery() {
    const component = this.component;

    return queryGeneric({
      args: {},
      returns: v.object({
        protocolVersion: v.number(),
      }),
      handler: async (ctx) => {
        return await ctx.runQuery(component.public.getProtocolVersion);
      },
    });
  }

  /**
   * Creates a compaction mutation for this collection.
   * Call this from cron jobs to compact CRDT deltas on a schedule.
   *
   * Compaction merges old CRDT deltas into efficient snapshots, reducing storage size.
   *
   * @param opts - Configuration options
   * @param opts.retentionDays - Compact deltas older than this many days (default: 90)
   * @param opts.checkCompact - Permission check hook
   * @param opts.onCompact - Lifecycle callback after compaction
   * @returns Convex internal mutation function
   */
  createCompactMutation(opts?: {
    retentionDays?: number;
    checkCompact?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    onCompact?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
  }) {
    const component = this.component;
    const collection = this.collectionName;
    const defaultRetentionDays = opts?.retentionDays ?? 90;

    return internalMutationGeneric({
      args: {
        retentionDays: v.optional(v.number()),
      },
      returns: v.any(),
      handler: async (ctx, args) => {
        // Permission check hook
        if (opts?.checkCompact) {
          await opts.checkCompact(ctx, collection);
        }

        // Call component with collection-specific retention
        const result = await ctx.runMutation(component.public.compactCollectionByName, {
          collection,
          retentionDays: args.retentionDays ?? defaultRetentionDays,
        });

        // Lifecycle hook
        if (opts?.onCompact) {
          await opts.onCompact(ctx, result);
        }

        return result;
      },
    });
  }

  /**
   * Creates a prune mutation for this collection.
   * Call this from cron jobs to clean up old snapshots on a schedule.
   *
   * Pruning deletes old snapshots while keeping the latest 2 per collection.
   *
   * @param opts - Configuration options
   * @param opts.retentionDays - Delete snapshots older than this many days (default: 180)
   * @param opts.checkPrune - Permission check hook
   * @param opts.onPrune - Lifecycle callback after pruning
   * @returns Convex internal mutation function
   */
  createPruneMutation(opts?: {
    retentionDays?: number;
    checkPrune?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    onPrune?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
  }) {
    const component = this.component;
    const collection = this.collectionName;
    const defaultRetentionDays = opts?.retentionDays ?? 180;

    return internalMutationGeneric({
      args: {
        retentionDays: v.optional(v.number()),
      },
      returns: v.any(),
      handler: async (ctx, args) => {
        // Permission check hook
        if (opts?.checkPrune) {
          await opts.checkPrune(ctx, collection);
        }

        // Call component with collection-specific retention
        const result = await ctx.runMutation(component.public.pruneCollectionByName, {
          collection,
          retentionDays: args.retentionDays ?? defaultRetentionDays,
        });

        // Lifecycle hook
        if (opts?.onPrune) {
          await opts.onPrune(ctx, result);
        }

        return result;
      },
    });
  }
}
