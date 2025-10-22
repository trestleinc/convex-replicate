// ========================================
// SHARED TYPE DEFINITIONS
// ========================================

/**
 * Base type for all documents synced with ConvexRx.
 * All synced documents must include these fields.
 */
export interface ConvexRxDocument {
  /** Client-generated UUID */
  id: string;
  /** Timestamp for replication tracking (auto-managed) */
  updatedTime: number;
}

/**
 * RxDB JSON Schema type for defining collection schemas
 */
export interface RxJsonSchema<T = any> {
  title: string;
  version: number;
  type: 'object';
  primaryKey: keyof T & string;
  properties: Record<string, any>;
  required: string[];
  indexes?: string[][];
}

/**
 * Convex client interface for type safety
 */
export interface ConvexClient {
  query: <T>(query: any, args?: any) => Promise<T>;
  mutation: <T>(mutation: any, args?: any) => Promise<T>;
  watchQuery: (query: any, args?: any) => ConvexWatch;
  close?: () => Promise<void>;
}

/**
 * Convex watch query return type
 */
export interface ConvexWatch {
  localQueryResult: () => any;
  onUpdate: (callback: () => void) => () => void;
}

/**
 * Utility to format errors consistently
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// ========================================
// SYNCED DOCUMENT TYPE
// ========================================

/**
 * Base type for all synced documents.
 * Extends ConvexRxDocument with soft delete support.
 * Standardized to use _deleted (with underscore) for soft deletes.
 */
export interface SyncedDocument extends ConvexRxDocument {
  /** Soft delete flag - when true, document is hidden from queries */
  _deleted?: boolean;
  /** Index signature for compatibility with Record<string, unknown> */
  [key: string]: unknown;
}

// ========================================
// BASE ACTIONS
// ========================================

/**
 * Base CRUD actions available to all sync implementations.
 * These are framework-agnostic and work with any reactive system.
 */
export interface BaseActions<TData extends SyncedDocument> {
  /** Insert a new document. Returns the generated ID. */
  insert: (doc: Omit<TData, keyof SyncedDocument>) => Promise<string>;
  /** Update an existing document by ID. */
  update: (id: string, updates: Partial<Omit<TData, keyof SyncedDocument>>) => Promise<void>;
  /** Soft delete a document by ID (sets _deleted: true). */
  delete: (id: string) => Promise<void>;
}

// ========================================
// MIDDLEWARE
// ========================================

/**
 * Middleware configuration for intercepting CRUD operations.
 * All hooks are optional and can be async.
 * Framework-agnostic - works with any reactive system.
 */
export interface MiddlewareConfig<TData extends SyncedDocument> {
  /** Called before insert. Can transform the document or throw to cancel. */
  beforeInsert?: (
    doc: Omit<TData, keyof SyncedDocument>
  ) => Omit<TData, keyof SyncedDocument> | Promise<Omit<TData, keyof SyncedDocument>>;

  /** Called after insert succeeds. */
  afterInsert?: (doc: TData) => void | Promise<void>;

  /** Called before update. Can transform updates or throw to cancel. */
  beforeUpdate?: (
    id: string,
    updates: Partial<Omit<TData, keyof SyncedDocument>>
  ) =>
    | Partial<Omit<TData, keyof SyncedDocument>>
    | Promise<Partial<Omit<TData, keyof SyncedDocument>>>;

  /** Called after update succeeds. */
  afterUpdate?: (id: string, doc: TData) => void | Promise<void>;

  /** Called before delete. Return false to cancel deletion. */
  beforeDelete?: (id: string) => boolean | Promise<boolean>;

  /** Called after delete succeeds. */
  afterDelete?: (id: string) => void | Promise<void>;

  /** Called when sync replication encounters an error. */
  onSyncError?: (error: Error) => void;
}
