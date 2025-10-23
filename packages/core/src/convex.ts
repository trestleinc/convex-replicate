/**
 * Convex Function Generator for ConvexRx
 *
 * Provides helpers to auto-generate the 3 required Convex functions
 * (changeStream, pullDocuments, pushDocuments) for any table.
 *
 * This eliminates the need to manually write replication logic for each table.
 */

import type { RegisteredMutation, RegisteredQuery } from 'convex/server';

// ========================================
// TYPE ALIASES FOR OPTION 1
// ========================================

/**
 * Type alias for the changeStream query.
 * Use this to annotate exports and preserve types through module boundaries.
 */
export type ConvexRxChangeStream = RegisteredQuery<
  'public',
  Record<string, never>,
  { timestamp: number; count: number }
>;

/**
 * Type alias for the pullDocuments query.
 * Use this to annotate exports and preserve types through module boundaries.
 */
export type ConvexRxPullDocuments = RegisteredQuery<
  'public',
  { checkpoint: any; limit: number },
  { documents: any[]; checkpoint: any }
>;

/**
 * Type alias for the pushDocuments mutation.
 * Use this to annotate exports and preserve types through module boundaries.
 */
export type ConvexRxPushDocuments = RegisteredMutation<'public', { changeRows: any[] }, any[]>;

// ========================================
// FUNCTION TEMPLATES
// ========================================

/**
 * Generates all 3 required Convex functions for a table.
 *
 * Usage in your Convex schema file:
 *
 * ```typescript
 * // convex/tasks.ts
 * import { generateConvexRxFunctions } from '@convex-rx/core/convex';
 * import { query, mutation } from './_generated/server';
 * import { v } from 'convex/values';
 *
 * const tableFunctions = generateConvexRxFunctions({
 *   tableName: 'tasks',
 *   query,
 *   mutation,
 *   v
 * });
 *
 * export const changeStream = tableFunctions.changeStream;
 * export const pullDocuments = tableFunctions.pullDocuments;
 * export const pushDocuments = tableFunctions.pushDocuments;
 * ```
 */
export function generateConvexRxFunctions(config: {
  tableName: string;
  query: any;
  mutation: any;
  v: any;
}): {
  changeStream: RegisteredQuery<
    'public',
    Record<string, never>,
    { timestamp: number; count: number }
  >;
  pullDocuments: RegisteredQuery<
    'public',
    { checkpoint: any; limit: number },
    { documents: any[]; checkpoint: any }
  >;
  pushDocuments: RegisteredMutation<'public', { changeRows: any[] }, any[]>;
} {
  const { tableName, query: queryBuilder, mutation: mutationBuilder, v } = config;

  // ========================================
  // 1. CHANGE STREAM
  // ========================================

  const changeStream = queryBuilder({
    args: {},
    handler: async (ctx: any) => {
      const allDocs = await ctx.db.query(tableName).collect();

      let latestTime = 0;
      for (const doc of allDocs) {
        if (doc.updatedTime > latestTime) {
          latestTime = doc.updatedTime;
        }
      }

      return {
        timestamp: latestTime || 0,
        count: allDocs.length,
      };
    },
  });

  // ========================================
  // 2. PULL DOCUMENTS
  // ========================================
  //
  // IMPORTANT: For optimal performance (10-100x faster), create an index in your Convex schema:
  //
  // export default defineSchema({
  //   yourTable: defineTable({
  //     // ... your fields
  //   }).index('by_updatedTime', ['updatedTime']),
  // });

  const pullDocuments = queryBuilder({
    args: {
      checkpoint: v.union(
        v.null(),
        v.object({
          id: v.string(),
          updatedTime: v.number(),
        })
      ),
      limit: v.number(),
    },
    handler: async (
      ctx: any,
      args: { checkpoint: { id: string; updatedTime: number } | null; limit: number }
    ) => {
      let docs: any;

      if (!args.checkpoint) {
        docs = await ctx.db.query(tableName).order('desc').take(args.limit);
      } else {
        const checkpoint = args.checkpoint;

        try {
          docs = await ctx.db
            .query(tableName)
            .withIndex('by_updatedTime', (q: any) => q.gt('updatedTime', checkpoint.updatedTime))
            .order('desc')
            .take(args.limit);
        } catch {
          docs = await ctx.db
            .query(tableName)
            .filter((q: any) =>
              q.or(
                q.gt(q.field('updatedTime'), checkpoint.updatedTime),
                q.and(
                  q.eq(q.field('updatedTime'), checkpoint.updatedTime),
                  q.gt(q.field('id'), checkpoint.id)
                )
              )
            )
            .order('desc')
            .take(args.limit);
        }
      }

      const documents = docs.map((doc: any) => {
        const { _id, _creationTime, ...cleanDoc } = doc;
        return {
          ...cleanDoc,
          deleted: doc.deleted === true,
        };
      });

      const newCheckpoint =
        documents.length > 0
          ? { id: documents[0].id, updatedTime: documents[0].updatedTime }
          : args.checkpoint || { id: '', updatedTime: 0 };

      return {
        documents,
        checkpoint: newCheckpoint,
      };
    },
  });

  // ========================================
  // 3. PUSH DOCUMENTS
  // ========================================
  //
  // Convex mutations are atomic - either all database operations succeed or all fail.
  // However, conflict detection happens per-document, so some documents may succeed
  // while others return conflicts that need to be re-synced.

  const pushDocuments = mutationBuilder({
    args: {
      changeRows: v.array(
        v.object({
          newDocumentState: v.any(), // Flexible schema - validate at runtime if needed
          assumedMasterState: v.optional(v.any()),
        })
      ),
    },
    handler: async (
      ctx: any,
      args: {
        changeRows: Array<{
          newDocumentState: any;
          assumedMasterState?: any;
        }>;
      }
    ) => {
      const conflicts = [];

      for (const changeRow of args.changeRows) {
        const { newDocumentState, assumedMasterState } = changeRow;

        const currentDoc = await ctx.db
          .query(tableName)
          .filter((q: any) => q.eq(q.field('id'), newDocumentState.id))
          .first();

        const realMasterState = currentDoc
          ? {
              ...currentDoc,
              deleted: currentDoc.deleted === true,
            }
          : null;

        // Detect conflicts by comparing updatedTime
        const hasConflict =
          (realMasterState && !assumedMasterState) ||
          (realMasterState &&
            assumedMasterState &&
            realMasterState.updatedTime !== assumedMasterState.updatedTime);

        if (hasConflict) {
          const { _id, _creationTime, ...cleanDoc } = realMasterState;
          conflicts.push(cleanDoc);
        } else {
          const timestamp = newDocumentState.updatedTime || Date.now();

          const { deleted, ...docWithoutDeleted } = newDocumentState;

          if (currentDoc) {
            await ctx.db.patch(currentDoc._id, {
              ...docWithoutDeleted,
              updatedTime: timestamp,
              deleted: deleted || false,
            });
          } else {
            await ctx.db.insert(tableName, {
              ...docWithoutDeleted,
              updatedTime: timestamp,
              deleted: deleted || false,
            });
          }
        }
      }

      return conflicts;
    },
  });

  return {
    changeStream: changeStream as RegisteredQuery<
      'public',
      Record<string, never>,
      { timestamp: number; count: number }
    >,
    pullDocuments: pullDocuments as RegisteredQuery<
      'public',
      { checkpoint: any; limit: number },
      { documents: any[]; checkpoint: any }
    >,
    pushDocuments: pushDocuments as RegisteredMutation<'public', { changeRows: any[] }, any[]>,
  };
}

// ========================================
// EXPORT HELPER FOR OPTION 2
// ========================================

/**
 * Helper function that generates Convex functions with proper type assertions.
 * This preserves types through module boundaries automatically.
 *
 * Usage (Option 2 - Single-line export):
 * ```typescript
 * import { exportConvexRxFunctions } from '@convex-rx/core';
 * import { query, mutation } from './_generated/server';
 * import { v } from 'convex/values';
 *
 * export const { changeStream, pullDocuments, pushDocuments } = exportConvexRxFunctions({
 *   tableName: 'tasks',
 *   query,
 *   mutation,
 *   v,
 * });
 * ```
 */
export function exportConvexRxFunctions(config: {
  tableName: string;
  query: any;
  mutation: any;
  v: any;
}): {
  changeStream: RegisteredQuery<
    'public',
    Record<string, never>,
    { timestamp: number; count: number }
  >;
  pullDocuments: RegisteredQuery<
    'public',
    { checkpoint: any; limit: number },
    { documents: any[]; checkpoint: any }
  >;
  pushDocuments: RegisteredMutation<'public', { changeRows: any[] }, any[]>;
} {
  const fns = generateConvexRxFunctions(config);

  return {
    changeStream: fns.changeStream as ConvexRxChangeStream,
    pullDocuments: fns.pullDocuments as ConvexRxPullDocuments,
    pushDocuments: fns.pushDocuments as ConvexRxPushDocuments,
  };
}

// ========================================
// EXPORT HELPER FOR CLEANER SYNTAX
// ========================================

/**
 * Alternative syntax for generating Convex functions.
 * Slightly cleaner API.
 *
 * @example
 * ```typescript
 * import { defineConvexRxTable } from '@convex-rx/core/convex';
 *
 * const { changeStream, pullDocuments, pushDocuments } = defineConvexRxTable('tasks');
 * export { changeStream, pullDocuments, pushDocuments };
 * ```
 */
export function defineConvexRxTable(tableName: string) {
  return {
    /**
     * Call this with your Convex query/mutation/v imports to generate functions
     */
    withConvex(
      query: any,
      mutation: any,
      v: any
    ): {
      changeStream: RegisteredQuery<
        'public',
        Record<string, never>,
        { timestamp: number; count: number }
      >;
      pullDocuments: RegisteredQuery<
        'public',
        { checkpoint: any; limit: number },
        { documents: any[]; checkpoint: any }
      >;
      pushDocuments: RegisteredMutation<'public', { changeRows: any[] }, any[]>;
    } {
      return generateConvexRxFunctions({ tableName, query, mutation, v });
    },
  };
}
