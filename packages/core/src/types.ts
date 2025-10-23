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
 * Property types for RxDB schemas.
 * Using const object pattern instead of enum for better TypeScript practices.
 */
export const PropertyType = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Object: 'object',
  Array: 'array',
  Integer: 'integer',
} as const;

export type PropertyType = (typeof PropertyType)[keyof typeof PropertyType];

/**
 * Property schema definition for RxDB schemas
 */
export interface PropertySchema {
  type: PropertyType;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  items?: PropertySchema;
  properties?: Record<string, PropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * RxDB JSON Schema type for defining collection schemas
 */
export interface RxJsonSchema<T = Record<string, unknown>> {
  title: string;
  version: number;
  type: 'object';
  primaryKey: keyof T & string;
  properties: Record<string, PropertySchema>;
  required: string[];
  indexes?: string[][];
}

/**
 * Convex client interface for type safety
 * Note: Using unknown for function references as Convex's FunctionReference
 * type requires specific imports that may not be available
 */
export interface ConvexClient {
  query: <T>(query: unknown, args?: unknown) => Promise<T>;
  mutation: <T>(mutation: unknown, args?: unknown) => Promise<T>;
  watchQuery: <T = unknown>(query: unknown, args?: unknown) => ConvexWatch<T>;
  close?: () => Promise<void>;
}

/**
 * Convex watch query return type
 */
export interface ConvexWatch<T = unknown> {
  localQueryResult: () => T | undefined;
  onUpdate: (callback: () => void) => () => void;
}

// ========================================
// SYNCED DOCUMENT TYPE
// ========================================

/**
 * Base type for all synced documents.
 * Extends ConvexRxDocument with soft delete support.
 * Standardized to use _deleted (with underscore) for soft deletes.
 *
 * Note: The index signature [key: string]: unknown allows for flexible
 * document schemas but reduces type safety. This is necessary for
 * RxDB's dynamic schema system and cross-collection compatibility.
 *
 * For better TypeScript support in your app, create specific interfaces
 * that extend SyncedDocument with your exact fields (without index signature).
 *
 * @example
 * ```typescript
 * interface Task extends SyncedDocument {
 *   text: string;
 *   isCompleted: boolean;
 *   // No index signature - full type safety in your app
 * }
 * ```
 */
export interface SyncedDocument extends ConvexRxDocument {
  /** Soft delete flag - when true, document is hidden from queries */
  _deleted?: boolean;
  /** Index signature for compatibility with RxDB's dynamic schema system */
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
