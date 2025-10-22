/**
 * Middleware execution for intercepting CRUD operations.
 *
 * Wraps base actions with middleware hooks to enable:
 * - Validation before operations
 * - Transformation of data
 * - Side effects after operations
 * - Cancellation of operations
 *
 * Framework-agnostic - works with any reactive system.
 */

import type { BaseActions, MiddlewareConfig, SyncedDocument } from './types';
import { getLogger } from './logger';

/**
 * Wraps base actions with middleware hooks.
 * Returns new action methods that execute middleware before/after base operations.
 *
 * @param baseActions - Unwrapped base CRUD actions
 * @param middleware - Middleware configuration with hooks
 * @param enableLogging - Enable logging for debugging (default: false)
 * @returns Wrapped actions that execute middleware
 *
 * @example
 * ```typescript
 * const wrappedActions = wrapActionsWithMiddleware(baseActions, {
 *   beforeInsert: async (doc) => {
 *     // Validate or transform document
 *     if (!doc.text) throw new Error('Text required');
 *     return { ...doc, text: doc.text.trim() };
 *   },
 *   afterInsert: async (doc) => {
 *     logger.info('Document inserted:', doc.id);
 *   }
 * }, true);
 * ```
 */
export function wrapActionsWithMiddleware<TData extends SyncedDocument>(
  baseActions: BaseActions<TData>,
  middleware?: MiddlewareConfig<TData>,
  enableLogging = false
): BaseActions<TData> {
  // If no middleware, return base actions as-is
  if (!middleware) {
    return baseActions;
  }

  const logger = getLogger('middleware', enableLogging);

  return {
    insert: async (doc: Omit<TData, keyof SyncedDocument>): Promise<string> => {
      // Before insert hook
      let processedDoc = doc;
      if (middleware.beforeInsert) {
        try {
          processedDoc = await middleware.beforeInsert(doc);
        } catch (error) {
          logger.error('Error in beforeInsert middleware', {
            error: error instanceof Error ? error.message : String(error),
            doc,
          });
          throw new Error(
            `beforeInsert middleware failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Execute base insert
      const id = await baseActions.insert(processedDoc);

      // After insert hook
      if (middleware.afterInsert) {
        try {
          // Fetch the full document that was inserted
          const fullDoc: TData = {
            ...processedDoc,
            id,
            updatedTime: Date.now(),
          } as unknown as TData;
          await middleware.afterInsert(fullDoc);
        } catch (error) {
          logger.error('Error in afterInsert middleware', {
            error: error instanceof Error ? error.message : String(error),
            id,
          });
          // Don't throw - insert already succeeded
        }
      }

      return id;
    },

    update: async (
      id: string,
      updates: Partial<Omit<TData, keyof SyncedDocument>>
    ): Promise<void> => {
      // Before update hook
      let processedUpdates = updates;
      if (middleware.beforeUpdate) {
        try {
          processedUpdates = await middleware.beforeUpdate(id, updates);
        } catch (error) {
          logger.error('Error in beforeUpdate middleware', {
            error: error instanceof Error ? error.message : String(error),
            id,
            updates,
          });
          throw new Error(
            `beforeUpdate middleware failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Execute base update
      await baseActions.update(id, processedUpdates);

      // After update hook
      if (middleware.afterUpdate) {
        try {
          // Note: We don't have the full document here, just the ID
          // If middleware needs the full doc, it should query it
          const doc: TData = { id, ...processedUpdates } as unknown as TData;
          await middleware.afterUpdate(id, doc);
        } catch (error) {
          logger.error('Error in afterUpdate middleware', {
            error: error instanceof Error ? error.message : String(error),
            id,
          });
          // Don't throw - update already succeeded
        }
      }
    },

    delete: async (id: string): Promise<void> => {
      // Before delete hook - can cancel deletion
      if (middleware.beforeDelete) {
        try {
          const shouldDelete = await middleware.beforeDelete(id);
          if (!shouldDelete) {
            // Deletion cancelled by middleware
            logger.info('Delete canceled by beforeDelete middleware', { id });
            return;
          }
        } catch (error) {
          logger.error('Error in beforeDelete middleware', {
            error: error instanceof Error ? error.message : String(error),
            id,
          });
          throw new Error(
            `beforeDelete middleware failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Execute base delete
      await baseActions.delete(id);

      // After delete hook
      if (middleware.afterDelete) {
        try {
          await middleware.afterDelete(id);
        } catch (error) {
          logger.error('Error in afterDelete middleware', {
            error: error instanceof Error ? error.message : String(error),
            id,
          });
          // Don't throw - delete already succeeded
        }
      }
    },
  };
}

/**
 * Setup sync error monitoring via middleware.
 * Subscribes to replication state errors and calls middleware hook.
 *
 * @param replicationState - RxDB replication state with error$ observable
 * @param middleware - Middleware configuration
 * @returns Cleanup function to unsubscribe (always returns a function, even if no-op)
 *
 * @example
 * ```typescript
 * const cleanup = setupSyncErrorMiddleware(replicationState, {
 *   onSyncError: (error) => {
 *     console.error('Sync error:', error);
 *     // Show toast notification, etc.
 *   }
 * });
 *
 * // Later: cleanup();
 * ```
 */
export function setupSyncErrorMiddleware(
  replicationState: {
    error$: { subscribe: (fn: (error: any) => void) => { unsubscribe: () => void } };
  },
  middleware?: MiddlewareConfig<any>
): () => void {
  if (!middleware?.onSyncError) {
    return () => {}; // Return no-op function instead of null
  }

  const subscription = replicationState.error$.subscribe((error) => {
    if (error && middleware.onSyncError) {
      middleware.onSyncError(error instanceof Error ? error : new Error(String(error)));
    }
  });

  return () => subscription.unsubscribe();
}
