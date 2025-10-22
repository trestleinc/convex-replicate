/**
 * Convex Function Generator for ConvexRx
 *
 * Provides helpers to auto-generate the 3 required Convex functions
 * (changeStream, pullDocuments, pushDocuments) for any table.
 *
 * This eliminates the need to manually write replication logic for each table.
 */

// ========================================
// TYPE DEFINITIONS
// ========================================

export interface ConvexRxTableFunctions {
  changeStream: any; // Convex query function
  pullDocuments: any; // Convex query function
  pushDocuments: any; // Convex mutation function
}

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
}): ConvexRxTableFunctions {
  const { tableName, query: queryBuilder, mutation: mutationBuilder, v } = config;

  // ========================================
  // 1. CHANGE STREAM
  // ========================================

  const changeStream = queryBuilder({
    args: {},
    handler: async (ctx: any) => {
      const allDocs = await ctx.db.query(tableName).collect();

      // Find latest updatedTime using deterministic for-loop
      let latestTime = 0;
      for (const doc of allDocs) {
        if (doc.updatedTime > latestTime) {
          latestTime = doc.updatedTime;
        }
      }

      return {
        timestamp: latestTime || Date.now(),
        count: allDocs.length,
      };
    },
  });

  // ========================================
  // 2. PULL DOCUMENTS
  // ========================================

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

      if (!args.checkpoint || (args.checkpoint.id === '' && args.checkpoint.updatedTime === 0)) {
        // Initial pull - get most recent documents
        docs = await ctx.db.query(tableName).order('desc').take(args.limit);
      } else {
        // Incremental pull - get documents newer than checkpoint
        // TypeScript now knows checkpoint is not null in this branch
        const checkpoint = args.checkpoint;
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

      // Map to clean objects (strip Convex internal fields)
      const documents = docs.map((doc: any) => {
        const { _id, _creationTime, ...cleanDoc } = doc;
        return {
          ...cleanDoc,
          deleted: doc.deleted || false,
        };
      });

      // Calculate new checkpoint from returned documents
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

        // Find current document state on server
        const currentDoc = await ctx.db
          .query(tableName)
          .filter((q: any) => q.eq(q.field('id'), newDocumentState.id))
          .first();

        // Convert current doc to client format for comparison
        const realMasterState = currentDoc
          ? {
              ...currentDoc,
              deleted: currentDoc.deleted || false,
            }
          : null;

        // Detect conflicts by comparing updatedTime
        const hasConflict =
          (realMasterState && !assumedMasterState) ||
          (realMasterState &&
            assumedMasterState &&
            realMasterState.updatedTime !== assumedMasterState.updatedTime);

        if (hasConflict) {
          // Conflict detected - return server state
          const { _id, _creationTime, ...cleanDoc } = realMasterState;
          conflicts.push(cleanDoc);
        } else {
          // No conflict - apply the change
          const timestamp = newDocumentState.updatedTime || Date.now();

          // Remove client-side fields before writing to Convex
          const { deleted, ...docWithoutDeleted } = newDocumentState;

          if (currentDoc) {
            // Update existing document
            await ctx.db.patch(currentDoc._id, {
              ...docWithoutDeleted,
              updatedTime: timestamp,
              deleted: deleted || false,
            });
          } else {
            // Insert new document
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
    changeStream,
    pullDocuments,
    pushDocuments,
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
    withConvex(query: any, mutation: any, v: any) {
      return generateConvexRxFunctions({ tableName, query, mutation, v });
    },
  };
}
