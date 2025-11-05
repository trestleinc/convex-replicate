/**
 * Schema utilities for defining replicated tables.
 * Automatically adds replication metadata fields so users don't have to.
 *
 * @example
 * ```typescript
 * // convex/schema.ts
 * import { defineSchema } from 'convex/server';
 * import { v } from 'convex/values';
 * import { replicatedTable } from '@trestleinc/replicate/server';
 *
 * export default defineSchema({
 *   tasks: replicatedTable(
 *     {
 *       id: v.string(),
 *       text: v.string(),
 *       isCompleted: v.boolean(),
 *     },
 *     (table) => table
 *       .index('by_id', ['id'])
 *       .index('by_timestamp', ['timestamp'])
 *   ),
 * });
 * ```
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Internal replication metadata fields added to every replicated table.
 * These are managed automatically by the replication layer.
 */
export type ReplicationFields = {
  /** Version number for conflict resolution */
  version: number;
  /** Last modification timestamp (Unix ms) */
  timestamp: number;
  /** Soft delete flag (true = deleted but recoverable) */
  deleted?: boolean;
  /** When the item was soft deleted (Unix ms) */
  deletedAt?: number;
};

/**
 * Wraps a table definition to automatically add replication metadata fields.
 *
 * Users define their business logic fields, and we inject:
 * - `version` - For conflict resolution
 * - `timestamp` - For incremental sync
 * - `deleted` - For soft deletes (30-day retention)
 * - `deletedAt` - Timestamp when deleted
 *
 * @param userFields - User's business logic fields (id, text, etc.)
 * @param applyIndexes - Optional callback to add indexes to the table
 * @returns TableDefinition with replication fields injected
 *
 * @example
 * ```typescript
 * // Simple table
 * tasks: replicatedTable({
 *   id: v.string(),
 *   text: v.string(),
 * })
 *
 * // With indexes
 * tasks: replicatedTable(
 *   {
 *     id: v.string(),
 *     text: v.string(),
 *   },
 *   (table) => table
 *     .index('by_id', ['id'])
 *     .index('by_timestamp', ['timestamp'])
 * )
 * ```
 */
export function replicatedTable(
  userFields: Record<string, any>,
  applyIndexes?: (table: any) => any
): any {
  // Create table with user fields + replication metadata
  const tableWithMetadata = defineTable({
    ...userFields,

    // Injected replication fields (hidden from user's mental model)
    version: v.number(),
    timestamp: v.number(),
    deleted: v.optional(v.boolean()),
    deletedAt: v.optional(v.number()),
  });

  // Apply user-defined indexes if provided
  if (applyIndexes) {
    return applyIndexes(tableWithMetadata);
  }

  return tableWithMetadata;
}
