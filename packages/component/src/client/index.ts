import type {
  Expand,
  FunctionReference,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from 'convex/server';
import type { GenericId } from 'convex/values';
import { api } from '../component/_generated/api';

/**
 * A client API for interacting with the Convex Replicate storage component.
 *
 * This class provides a type-safe, scoped interface for storing and retrieving
 * CRDT document data from the replicate component. Each instance is scoped to
 * a specific collection name, eliminating the need to pass collectionName to
 * every method call.
 *
 * @example
 * ```typescript
 * import { components } from "./_generated/api";
 * import { ConvexStorage } from "@trestleinc/convex-replicate-component";
 *
 * // Create a storage instance for the "tasks" collection
 * const tasksStorage = new ConvexStorage(components.replicate, "tasks");
 *
 * export const submitTask = mutation({
 *   handler: async (ctx, args) => {
 *     return await tasksStorage.submitDocument(
 *       ctx,
 *       args.id,
 *       args.document,
 *       args.version
 *     );
 *   }
 * });
 *
 * export const getTasks = query({
 *   handler: async (ctx, args) => {
 *     return await tasksStorage.pullChanges(ctx, args.checkpoint, args.limit);
 *   }
 * });
 * ```
 *
 * @template TDocument - The document type being stored (must have an id field)
 */
export class ConvexStorage<_TDocument extends { id: string } = { id: string }> {
  /**
   * Create a new ConvexStorage instance scoped to a specific collection.
   *
   * @param component - The replicate component from your generated API
   * @param collectionName - The name of the collection to interact with
   *
   * @example
   * ```typescript
   * const tasksStorage = new ConvexStorage(
   *   components.replicate,
   *   "tasks"
   * );
   * ```
   */
  constructor(
    private component: UseApi<typeof api>,
    private collectionName: string
  ) {}

  /**
   * Insert a new document into the replicate component storage.
   *
   * This stores the CRDT bytes in the component's internal storage table.
   *
   * @param ctx - Convex mutation context
   * @param documentId - Unique identifier for the document
   * @param crdtBytes - The CRDT binary data (from Automerge.save())
   * @param version - Version number for conflict resolution
   * @returns Success indicator
   */
  async insertDocument(
    ctx: RunMutationCtx,
    documentId: string,
    crdtBytes: ArrayBuffer,
    version: number
  ): Promise<{ success: boolean }> {
    return ctx.runMutation(this.component.public.insertDocument, {
      collectionName: this.collectionName,
      documentId,
      crdtBytes,
      version,
    });
  }

  /**
   * Update an existing document in the replicate component storage.
   *
   * @param ctx - Convex mutation context
   * @param documentId - Unique identifier for the document
   * @param crdtBytes - The CRDT binary data (from Automerge.save())
   * @param version - Version number for conflict resolution
   * @returns Success indicator
   */
  async updateDocument(
    ctx: RunMutationCtx,
    documentId: string,
    crdtBytes: ArrayBuffer,
    version: number
  ): Promise<{ success: boolean }> {
    return ctx.runMutation(this.component.public.updateDocument, {
      collectionName: this.collectionName,
      documentId,
      crdtBytes,
      version,
    });
  }

  /**
   * Delete a document from the replicate component storage.
   *
   * @param ctx - Convex mutation context
   * @param documentId - Unique identifier for the document
   * @returns Success indicator
   */
  async deleteDocument(ctx: RunMutationCtx, documentId: string): Promise<{ success: boolean }> {
    return ctx.runMutation(this.component.public.deleteDocument, {
      collectionName: this.collectionName,
      documentId,
    });
  }

  /**
   * Pull document changes from the replicate component storage.
   *
   * Retrieves CRDT bytes for documents that have been modified since the
   * provided checkpoint, enabling incremental synchronization.
   *
   * @param ctx - Convex query context
   * @param checkpoint - Last known modification timestamp
   * @param limit - Maximum number of changes to retrieve (default: 100)
   * @returns Array of changes with updated checkpoint
   */
  async pullChanges(
    ctx: RunQueryCtx,
    checkpoint: { lastModified: number },
    limit?: number
  ): Promise<{
    changes: Array<{
      documentId: string;
      crdtBytes: ArrayBuffer;
      version: number;
      timestamp: number;
    }>;
    checkpoint: { lastModified: number };
    hasMore: boolean;
  }> {
    return ctx.runQuery(this.component.public.pullChanges, {
      collectionName: this.collectionName,
      checkpoint,
      limit,
    }) as any;
  }

  /**
   * Subscribe to collection changes via a reactive query.
   *
   * Returns a lightweight summary (timestamp and count) that changes whenever
   * documents in the collection are modified. Use this with Convex's reactive
   * queries to trigger UI updates or data synchronization.
   *
   * @param ctx - Convex query context
   * @returns Latest timestamp and document count
   *
   * @example
   * ```typescript
   * // Use in a query to reactively detect changes
   * export const watchTasks = query({
   *   handler: async (ctx) => {
   *     const stream = await tasksStorage.changeStream(ctx);
   *     // When stream.timestamp or stream.count changes, query reruns
   *     return stream;
   *   }
   * });
   * ```
   */
  async changeStream(ctx: RunQueryCtx): Promise<{ timestamp: number; count: number }> {
    return ctx.runQuery(this.component.public.changeStream, {
      collectionName: this.collectionName,
    });
  }
}

/**
 * Re-export the component API for direct access if needed.
 */
export { api };

/* Type utilities */

type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>['runQuery'];
};

type RunMutationCtx = {
  runMutation: GenericMutationCtx<GenericDataModel>['runMutation'];
};

export type OpaqueIds<T> = T extends GenericId<infer _T>
  ? string
  : T extends (infer U)[]
    ? OpaqueIds<U>[]
    : T extends object
      ? { [K in keyof T]: OpaqueIds<T[K]> }
      : T;

export type UseApi<API> = Expand<{
  [mod in keyof API]: API[mod] extends FunctionReference<
    infer FType,
    'public',
    infer FArgs,
    infer FReturnType,
    infer FComponentPath
  >
    ? FunctionReference<FType, 'internal', OpaqueIds<FArgs>, OpaqueIds<FReturnType>, FComponentPath>
    : UseApi<API[mod]>;
}>;
