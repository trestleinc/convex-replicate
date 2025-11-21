import { v } from 'convex/values';
import type { GenericMutationCtx, GenericQueryCtx, GenericDataModel } from 'convex/server';
import { queryGeneric, mutationGeneric, internalMutationGeneric } from 'convex/server';

export class Replicate<T extends object> {
  constructor(
    public component: any,
    public collectionName: string,
    public options?: {
      migrations?: {
        schemaVersion: number;
        functions: Record<number, (doc: any) => any>;
      };
    }
  ) {}

  createStreamQuery(opts?: {
    evalRead?: (ctx: GenericQueryCtx<GenericDataModel>, collection: string) => void | Promise<void>;
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
        if (opts?.evalRead) {
          await opts.evalRead(ctx, collection);
        }
        const result = await ctx.runQuery(component.public.stream, {
          collection,
          checkpoint: args.checkpoint,
          limit: args.limit,
          vector: args.vector,
        });

        if (opts?.onStream) {
          await opts.onStream(ctx, result);
        }

        return result;
      },
    });
  }

  createSSRQuery(opts?: {
    evalRead?: (ctx: GenericQueryCtx<GenericDataModel>, collection: string) => void | Promise<void>;
    transform?: (docs: T[]) => T[] | Promise<T[]>;
    includeCRDTState?: boolean;
  }) {
    const collection = this.collectionName;
    const component = this.component;

    return queryGeneric({
      args: {},
      returns: v.object({
        documents: v.any(),
        checkpoint: v.optional(v.object({ lastModified: v.number() })),
        count: v.number(),
        crdtBytes: v.optional(v.bytes()),
      }),
      handler: async (ctx) => {
        if (opts?.evalRead) {
          await opts.evalRead(ctx, collection);
        }
        let docs = (await ctx.db.query(collection).collect()) as T[];
        if (opts?.transform) {
          docs = await opts.transform(docs);
        }

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

        if (opts?.includeCRDTState) {
          const crdtState = await ctx.runQuery(component.public.getInitialState, {
            collection,
          });

          if (crdtState) {
            response.crdtBytes = crdtState.crdtBytes;
            response.checkpoint = crdtState.checkpoint;
          }
        }
        return response;
      },
    });
  }

  createInsertMutation(opts?: {
    evalWrite?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
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

        if (opts?.evalWrite) {
          await opts.evalWrite(ctx, doc);
        }

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

        await ctx.runMutation(component.public.insertDocument, {
          collection,
          documentId: args.documentId,
          crdtBytes: args.crdtBytes,
          version: args.version,
        });

        await ctx.db.insert(collection, {
          id: args.documentId,
          ...(args.materializedDoc as object),
          version: args.version,
          timestamp: Date.now(),
        });

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

  createUpdateMutation(opts?: {
    evalWrite?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
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
        if (opts?.evalWrite) {
          await opts.evalWrite(ctx, doc);
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

  createRemoveMutation(opts?: {
    evalRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
    onRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
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
        if (opts?.evalRemove) {
          await opts.evalRemove(ctx, documentId);
        }

        await ctx.runMutation(component.public.deleteDocument, {
          collection,
          documentId: documentId,
          crdtBytes: args.crdtBytes,
          version: args.version,
        });

        const existing = await ctx.db
          .query(collection)
          .filter((q) => q.eq(q.field('id'), documentId))
          .first();

        if (existing) {
          await ctx.db.delete(existing._id);
        }

        if (opts?.onRemove) {
          await opts.onRemove(ctx, documentId);
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

  private migrate(doc: any, fromVersion: number): any {
    if (!this.options?.migrations) {
      return doc;
    }

    let currentDoc = doc;
    const targetVersion = this.options.migrations.schemaVersion;

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

  createCompactMutation(opts?: {
    retention?: number;
    evalCompact?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    onCompact?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
  }) {
    const component = this.component;
    const collection = this.collectionName;
    const defaultRetention = opts?.retention ?? 90;

    return internalMutationGeneric({
      args: {
        retention: v.optional(v.number()),
      },
      returns: v.any(),
      handler: async (ctx, args) => {
        if (opts?.evalCompact) {
          await opts.evalCompact(ctx, collection);
        }
        const result = await ctx.runMutation(component.public.compactCollectionByName, {
          collection,
          retentionDays: args.retention ?? defaultRetention,
        });

        if (opts?.onCompact) {
          await opts.onCompact(ctx, result);
        }

        return result;
      },
    });
  }

  createPruneMutation(opts?: {
    retention?: number;
    evalPrune?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    onPrune?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
  }) {
    const component = this.component;
    const collection = this.collectionName;
    const defaultRetention = opts?.retention ?? 180;

    return internalMutationGeneric({
      args: {
        retention: v.optional(v.number()),
      },
      returns: v.any(),
      handler: async (ctx, args) => {
        if (opts?.evalPrune) {
          await opts.evalPrune(ctx, collection);
        }

        const result = await ctx.runMutation(component.public.pruneCollectionByName, {
          collection,
          retentionDays: args.retention ?? defaultRetention,
        });

        if (opts?.onPrune) {
          await opts.onPrune(ctx, result);
        }

        return result;
      },
    });
  }
}
