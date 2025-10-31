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
 * import { ConvexReplicateStorage } from "@convex-replicate/component";
 *
 * // Create a storage instance for the "tasks" collection
 * const tasksStorage = new ConvexReplicateStorage(components.replicate, "tasks");
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
export class ConvexReplicateStorage<TDocument extends { id: string } = { id: string }> {
  /**
   * Create a new ConvexReplicateStorage instance scoped to a specific collection.
   *
   * @param component - The replicate component from your generated API
   * @param collectionName - The name of the collection to interact with
   *
   * @example
   * ```typescript
   * const tasksStorage = new ConvexReplicateStorage(
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
   * Submit a document to the replicate component storage.
   *
   * This stores the document data in the component's internal storage table,
   * making it available for replication and synchronization across clients.
   *
   * @param ctx - Convex mutation context
   * @param documentId - Unique identifier for the document
   * @param document - The document data to store
   * @param version - Version number for conflict resolution
   * @returns Success indicator
   *
   * @example
   * ```typescript
   * await tasksStorage.submitDocument(ctx, "task-123", {
   *   id: "task-123",
   *   text: "Complete the project",
   *   isCompleted: false
   * }, 1);
   * ```
   */
  async submitDocument(
    ctx: RunMutationCtx,
    documentId: string,
    document: TDocument,
    version: number
  ): Promise<{ success: boolean }> {
    return ctx.runMutation(this.component.public.submitDocument, {
      collectionName: this.collectionName,
      documentId,
      document,
      version,
    });
  }

  /**
   * Pull document changes from the replicate component storage.
   *
   * Retrieves documents that have been modified since the provided checkpoint,
   * enabling incremental synchronization. Use this for efficient polling or
   * initial data loading.
   *
   * @param ctx - Convex query context
   * @param checkpoint - Last known modification timestamp
   * @param limit - Maximum number of changes to retrieve (default: 100)
   * @returns Array of changes with updated checkpoint
   *
   * @example
   * ```typescript
   * const result = await tasksStorage.pullChanges(ctx, { lastModified: 0 }, 50);
   * // result.changes contains up to 50 modified documents
   * // result.checkpoint contains the new lastModified timestamp
   * // result.hasMore indicates if more changes are available
   * ```
   */
  async pullChanges(
    ctx: RunQueryCtx,
    checkpoint: { lastModified: number },
    limit?: number
  ): Promise<{
    changes: Array<{
      documentId: string;
      document: TDocument;
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
    });
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

  /**
   * Retrieve metadata for a specific document.
   *
   * Fetches document data, version, and timestamp without pulling all changes.
   * Useful for checking if a document exists or getting its current state.
   *
   * @param ctx - Convex query context
   * @param documentId - Unique identifier for the document
   * @returns Document metadata or null if not found
   *
   * @example
   * ```typescript
   * const taskMeta = await tasksStorage.getDocumentMetadata(ctx, "task-123");
   * if (taskMeta) {
   *   console.log(`Task version: ${taskMeta.version}`);
   *   console.log(`Last modified: ${taskMeta.timestamp}`);
   * }
   * ```
   */
  async getDocumentMetadata(
    ctx: RunQueryCtx,
    documentId: string
  ): Promise<{
    documentId: string;
    version: number;
    timestamp: number;
    document: TDocument;
  } | null> {
    return ctx.runQuery(this.component.public.getDocumentMetadata, {
      collectionName: this.collectionName,
      documentId,
    });
  }

  /**
   * Create a scoped API for a specific document ID.
   *
   * Returns an object with methods pre-bound to a specific document,
   * similar to ShardedCounter's `.for()` pattern.
   *
   * @param documentId - The document ID to scope methods to
   * @returns Object with document-scoped methods
   *
   * @example
   * ```typescript
   * const task123 = tasksStorage.for("task-123");
   *
   * await task123.submit(ctx, { id: "task-123", text: "..." }, 1);
   * const metadata = await task123.getMetadata(ctx);
   * ```
   */
  for(documentId: string) {
    return {
      /**
       * Submit this specific document.
       */
      submit: async (ctx: RunMutationCtx, document: TDocument, version: number) =>
        this.submitDocument(ctx, documentId, document, version),

      /**
       * Get metadata for this specific document.
       */
      getMetadata: async (ctx: RunQueryCtx) => this.getDocumentMetadata(ctx, documentId),
    };
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
