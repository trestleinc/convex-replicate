import type { GenericMutationCtx, GenericQueryCtx, GenericDataModel } from 'convex/server';
import { Replicate } from '$/server/storage.js';

/**
 * Define replicate handlers for a collection. Returns all the queries/mutations
 * needed to sync a collection between client and server.
 *
 * @example
 * ```typescript
 * // convex/tasks.ts
 * export const { stream, material, insert, update, remove, protocol } =
 *   defineReplicate<Task>({
 *     component: components.replicate,
 *     collection: 'tasks',
 *   });
 * ```
 */
export function defineReplicate<T extends object>(config: {
  component: any;
  collection: string;
  compaction?: { retention: number };
  pruning?: { retention: number };
  versioning?: { keepCount?: number; retentionDays?: number };
  hooks?: {
    evalRead?: (ctx: GenericQueryCtx<GenericDataModel>, collection: string) => void | Promise<void>;
    evalWrite?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    evalRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
    onStream?: (ctx: GenericQueryCtx<GenericDataModel>, result: any) => void | Promise<void>;
    onInsert?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onUpdate?: (ctx: GenericMutationCtx<GenericDataModel>, doc: T) => void | Promise<void>;
    onRemove?: (ctx: GenericMutationCtx<GenericDataModel>, docId: string) => void | Promise<void>;
    transform?: (docs: T[]) => T[] | Promise<T[]>;
    evalCompact?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    evalPrune?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string
    ) => void | Promise<void>;
    onCompact?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
    onPrune?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
    // Version hooks
    evalVersion?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string,
      documentId: string
    ) => void | Promise<void>;
    onVersion?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
    evalRestore?: (
      ctx: GenericMutationCtx<GenericDataModel>,
      collection: string,
      documentId: string,
      versionId: string
    ) => void | Promise<void>;
    onRestore?: (ctx: GenericMutationCtx<GenericDataModel>, result: any) => void | Promise<void>;
  };
}) {
  const storage = new Replicate<T>(config.component, config.collection);

  return {
    stream: storage.createStreamQuery({
      evalRead: config.hooks?.evalRead,
      onStream: config.hooks?.onStream,
    }),

    material: storage.createSSRQuery({
      evalRead: config.hooks?.evalRead,
      transform: config.hooks?.transform,
    }),

    insert: storage.createInsertMutation({
      evalWrite: config.hooks?.evalWrite,
      onInsert: config.hooks?.onInsert,
    }),

    update: storage.createUpdateMutation({
      evalWrite: config.hooks?.evalWrite,
      onUpdate: config.hooks?.onUpdate,
    }),

    remove: storage.createRemoveMutation({
      evalRemove: config.hooks?.evalRemove,
      onRemove: config.hooks?.onRemove,
    }),

    protocol: storage.createProtocolVersionQuery(),

    compact: storage.createCompactMutation({
      retention: config.compaction?.retention,
      evalCompact: config.hooks?.evalCompact,
      onCompact: config.hooks?.onCompact,
    }),

    prune: storage.createPruneMutation({
      retention: config.pruning?.retention,
      evalPrune: config.hooks?.evalPrune,
      onPrune: config.hooks?.onPrune,
    }),

    // Version History APIs
    createVersion: storage.createVersionMutation({
      evalVersion: config.hooks?.evalVersion,
      onVersion: config.hooks?.onVersion,
    }),

    listVersions: storage.createListVersionsQuery({
      evalRead: config.hooks?.evalRead,
    }),

    getVersion: storage.createGetVersionQuery({
      evalRead: config.hooks?.evalRead,
    }),

    restoreVersion: storage.createRestoreVersionMutation({
      evalRestore: config.hooks?.evalRestore,
      onRestore: config.hooks?.onRestore,
    }),

    deleteVersion: storage.createDeleteVersionMutation(),

    pruneVersions: storage.createPruneVersionsMutation({
      keepCount: config.versioning?.keepCount,
      retentionDays: config.versioning?.retentionDays,
    }),
  };
}
