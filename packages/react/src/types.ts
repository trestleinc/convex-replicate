/**
 * Consolidated TypeScript types for @convex-rx/react
 *
 * This file contains all shared type definitions for the React package,
 * including the main hook configuration, extension builders, and result types.
 */

import type {
  ConvexClient,
  ConvexRxError,
  RxConflictHandler,
  RxJsonSchema,
  SyncedDocument,
  BaseActions,
  MiddlewareConfig,
} from '@convex-rx/core';
import type { Collection, UtilsRecord } from '@tanstack/react-db';
import type { RxCollection, RxDatabase } from 'rxdb';
import type { RxReplicationState } from 'rxdb/plugins/replication';

// ========================================
// TYPE INFERENCE HELPERS
// ========================================

/**
 * Extract the data type from an RxJsonSchema.
 * Example: RxJsonSchema<Task & SyncedDocument> => Task & SyncedDocument
 */
export type InferSchemaType<T> = T extends RxJsonSchema<infer U> ? U : never;

/**
 * Extract the return type from an ActionBuilder function.
 */
export type InferActionsType<
  TData extends SyncedDocument,
  TBuilder,
> = TBuilder extends ActionBuilder<TData, infer A> ? A : Record<string, never>;

/**
 * Extract the return type from a QueryBuilder function.
 */
export type InferQueriesType<
  TData extends SyncedDocument,
  TBuilder,
> = TBuilder extends QueryBuilder<TData, infer Q> ? Q : Record<string, never>;

/**
 * Extract the return type from a SubscriptionBuilder function.
 */
export type InferSubscriptionsType<
  TData extends SyncedDocument,
  TBuilder,
> = TBuilder extends SubscriptionBuilder<TData, infer S> ? S : Record<string, never>;

// ========================================
// REACT-SPECIFIC CONTEXT TYPES
// ========================================

// Note: SyncedDocument, BaseActions, and MiddlewareConfig are now in @convex-rx/core
// Import them directly from core instead of from this package

/**
 * Context provided to extension builders (actions, queries, subscriptions).
 * Gives access to all underlying sync primitives.
 * React-specific: includes TanStack DB Collection.
 */
export interface HookContext<TData extends SyncedDocument> {
  /** TanStack DB collection - reactive React-friendly wrapper */
  collection: Collection<TData, string, UtilsRecord>;
  /** RxDB collection - direct access to RxDB queries and operations */
  rxCollection: RxCollection<TData>;
  /** RxDB database instance */
  database: RxDatabase;
  /** Replication state - observables for sync status (error$, active$, etc.) */
  replicationState: RxReplicationState<TData, Record<string, never>>;
}

// ========================================
// EXTENSION BUILDERS
// ========================================

/**
 * Builder function for custom actions.
 * Receives base actions and context, returns custom action methods.
 *
 * @example
 * ```typescript
 * actions: (base, ctx) => ({
 *   toggle: async (id: string) => {
 *     const doc = await ctx.rxCollection.findOne(id).exec();
 *     if (doc) await base.update(id, { isCompleted: !doc.isCompleted });
 *   }
 * })
 * ```
 */
export type ActionBuilder<
  TData extends SyncedDocument,
  TActions extends Record<string, (...args: any[]) => any>,
> = (base: BaseActions<TData>, ctx: HookContext<TData>) => TActions;

/**
 * Builder function for custom queries/computed values.
 * Receives context, returns query methods.
 *
 * @example
 * ```typescript
 * queries: (ctx) => ({
 *   getCompleted: () => ctx.collection.toArray.filter(d => d.isCompleted),
 *   getByUser: (userId: string) => ctx.collection.toArray.filter(d => d.userId === userId)
 * })
 * ```
 */
export type QueryBuilder<
  TData extends SyncedDocument,
  TQueries extends Record<string, (...args: any[]) => any>,
> = (ctx: HookContext<TData>) => TQueries;

/**
 * Builder function for custom subscriptions.
 * Receives context, returns subscription methods that return unsubscribe functions.
 *
 * @example
 * ```typescript
 * subscriptions: (ctx) => ({
 *   onComplete: (callback: (doc: TData) => void) => {
 *     return ctx.rxCollection.$.subscribe((event) => {
 *       if (event.documentData.isCompleted) callback(event.documentData);
 *     });
 *   }
 * })
 * ```
 */
export type SubscriptionBuilder<
  TData extends SyncedDocument,
  TSubscriptions extends Record<
    string,
    (...args: any[]) => (() => void) | { unsubscribe: () => void }
  >,
> = (ctx: HookContext<TData>) => TSubscriptions;

// ========================================
// HOOK CONFIGURATION
// ========================================

/**
 * Configuration for useConvexRx hook.
 *
 * IMPORTANT: ConvexRxProvider is REQUIRED. You must wrap your app with it.
 * The convexClient is provided automatically via ConvexRxProvider.
 */
export interface UseConvexRxConfig<
  TData extends SyncedDocument,
  TActions extends Record<string, (...args: any[]) => any> = Record<string, never>,
  TQueries extends Record<string, (...args: any[]) => any> = Record<string, never>,
  TSubscriptions extends Record<
    string,
    (...args: any[]) => (() => void) | { unsubscribe: () => void }
  > = Record<string, never>,
> {
  // ========== Required ==========

  /** Table/collection name in Convex */
  table: string;

  /** RxDB JSON schema for the collection */
  schema: RxJsonSchema<TData>;

  /**
   * Convex API functions for sync.
   * For better type safety, use FunctionReference from 'convex/server'.
   *
   * @example
   * ```typescript
   * import { api } from './convex/_generated/api';
   *
   * convexApi: {
   *   changeStream: api.tasks.changeStream,
   *   pullDocuments: api.tasks.pullDocuments,
   *   pushDocuments: api.tasks.pushDocuments,
   * }
   * ```
   */
  convexApi: {
    changeStream: any;
    pullDocuments: any;
    pushDocuments: any;
  };

  // ========== Optional - Config Overrides ==========

  /** Database name (defaults to table name) */
  databaseName?: string;

  /** Batch size for replication (default: 50) */
  batchSize?: number;

  /** Enable logging for debugging */
  enableLogging?: boolean;

  /** Conflict resolution handler (default: last-write-wins) */
  conflictHandler?: RxConflictHandler<TData>;

  /**
   * Initial data for SSR hydration.
   * If provided, data state will be immediately populated with this data
   * instead of showing loading state. Useful for server-side rendering.
   *
   * Accepts either:
   * - Full synced documents with id, updatedTime, _deleted
   * - Partial user data (without sync fields) - system will add them
   *
   * @example
   * ```typescript
   * const { tasks } = Route.useLoaderData();
   * const tasksDb = useConvexRx({
   *   table: 'tasks',
   *   schema: taskSchema,
   *   convexApi: api.tasks,
   *   initialData: tasks, // Can be Task[] or (Task & SyncedDocument)[]
   * });
   * ```
   */
  initialData?: Omit<TData, keyof SyncedDocument>[] | TData[];

  // ========== Optional - Extensions ==========

  /** Custom action builder */
  actions?: ActionBuilder<TData, TActions>;

  /** Custom query builder */
  queries?: QueryBuilder<TData, TQueries>;

  /** Custom subscription builder */
  subscriptions?: SubscriptionBuilder<TData, TSubscriptions>;

  /** Middleware for intercepting operations */
  middleware?: MiddlewareConfig<TData>;
}

// ========================================
// STATUS TYPES
// ========================================

/**
 * Consolidated status object for ConvexRx hook.
 * Groups all state information in one place for better DX.
 */
export interface ConvexRxStatus {
  /** Loading state - true when database is initializing */
  isLoading: boolean;

  /** Ready state - true when collection is ready */
  isReady: boolean;

  /** Background replication state - true when RxDB is actively replicating with Convex */
  isReplicating: boolean;

  /** Strongly-typed error object if initialization or replication fails */
  error: ConvexRxError | null;
}

// ========================================
// HOOK RESULT
// ========================================

/**
 * Result returned by useConvexRx hook.
 * Combines data, status, actions, and custom extensions.
 */
export interface UseConvexRxResult<
  TData extends SyncedDocument,
  TActions extends Record<string, (...args: any[]) => any> = Record<string, never>,
  TQueries extends Record<string, (...args: any[]) => any> = Record<string, never>,
  TSubscriptions extends Record<
    string,
    (...args: any[]) => (() => void) | { unsubscribe: () => void }
  > = Record<string, never>,
> {
  // ========== Data ==========

  /** Array of synced documents (filtered to exclude _deleted: true) */
  data: TData[];

  /** Consolidated status object with all state information */
  status: ConvexRxStatus;

  // ========== Actions ==========

  /** All actions: base CRUD (insert, update, delete) + custom actions */
  actions: BaseActions<TData> & TActions;

  /** Custom queries (if provided via config.queries) */
  queries: TQueries;

  /** Custom subscriptions (if provided via config.subscriptions) */
  subscribe: TSubscriptions;

  // ========== Advanced Access ==========

  /** TanStack DB collection for direct access */
  collection: Collection<TData, string, UtilsRecord> | null;

  /** RxDB collection for direct access */
  rxCollection: RxCollection<TData> | null;

  /** Replication state for monitoring sync */
  replicationState: RxReplicationState<TData, Record<string, never>> | null;

  /** Purge all local storage and reload the page */
  purgeStorage: () => Promise<void>;
}

// ========================================
// PROVIDER TYPES
// ========================================

/**
 * Configuration for ConvexRxProvider.
 * Allows setting defaults for all hooks in the app.
 */
export interface ConvexRxConfig {
  /** Convex client instance */
  convexClient: ConvexClient;

  /** Default database name (can be overridden per-hook) */
  databaseName?: string;

  /** Default batch size for replication */
  batchSize?: number;

  /** Enable logging for all collections */
  enableLogging?: boolean;

  /** Default conflict handler for all collections */
  conflictHandler?: RxConflictHandler<any>;
}

/**
 * Internal context value with isConfigured flag
 */
export interface ConvexRxContextValue extends ConvexRxConfig {
  isConfigured: boolean;
}

// ========================================
// SYNC INSTANCE TYPES
// ========================================

/**
 * Instance returned by createConvexRx (internal).
 * Contains all sync primitives and cleanup function.
 */
export interface ConvexRxInstance<TData extends SyncedDocument> {
  /** TanStack DB collection - reactive wrapper around RxDB */
  collection: Collection<TData, string, UtilsRecord>;

  /** Underlying RxDB collection */
  rxCollection: RxCollection<TData>;

  /** RxDB database instance */
  database: RxDatabase;

  /** RxDB replication state with observables (error$, active$, received$, sent$) */
  replicationState: RxReplicationState<TData, Record<string, never>>;

  /** Cleanup function to cancel replication and remove database */
  cleanup: () => Promise<void>;
}

// Note: Configuration for createConvexRx is ConvexRxDBConfig from @convex-rx/core
// We re-export it for convenience but use the core's type directly
