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
