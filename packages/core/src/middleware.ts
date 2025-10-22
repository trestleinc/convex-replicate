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

/**
 * Wraps base actions with middleware hooks.
 * Returns new action methods that execute middleware before/after base operations.
 *
 * @param baseActions - Unwrapped base CRUD actions
 * @param middleware - Middleware configuration with hooks
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
 *     console.log('Document inserted:', doc.id);
 *   }
 * });
 * ```
 */
export function wrapActionsWithMiddleware<TData extends SyncedDocument>(
  baseActions: BaseActions<TData>,
  middleware?: MiddlewareConfig<TData>,
): BaseActions<TData> {
  // If no middleware, return base actions as-is
  if (!middleware) {
    return baseActions;
  }

  return {
    insert: async (doc: Omit<TData, keyof SyncedDocument>): Promise<string> => {
      // Before insert hook
      let processedDoc = doc;
      if (middleware.beforeInsert) {
        processedDoc = await middleware.beforeInsert(doc);
      }

      // Execute base insert
      const id = await baseActions.insert(processedDoc);

      // After insert hook
      if (middleware.afterInsert) {
        // Fetch the full document that was inserted
        const fullDoc: TData = {
          ...processedDoc,
          id,
          updatedTime: Date.now(),
        } as unknown as TData;
        await middleware.afterInsert(fullDoc);
      }

      return id;
    },

    update: async (
      id: string,
      updates: Partial<Omit<TData, keyof SyncedDocument>>,
    ): Promise<void> => {
      // Before update hook
      let processedUpdates = updates;
      if (middleware.beforeUpdate) {
        processedUpdates = await middleware.beforeUpdate(id, updates);
      }

      // Execute base update
      await baseActions.update(id, processedUpdates);

      // After update hook
      if (middleware.afterUpdate) {
        // Note: We don't have the full document here, just the ID
        // If middleware needs the full doc, it should query it
        const doc: TData = { id, ...processedUpdates } as unknown as TData;
        await middleware.afterUpdate(id, doc);
      }
    },

    delete: async (id: string): Promise<void> => {
      // Before delete hook - can cancel deletion
      if (middleware.beforeDelete) {
        const shouldDelete = await middleware.beforeDelete(id);
        if (!shouldDelete) {
          // Deletion cancelled by middleware
          return;
        }
      }

      // Execute base delete
      await baseActions.delete(id);

      // After delete hook
      if (middleware.afterDelete) {
        await middleware.afterDelete(id);
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
 * @returns Cleanup function to unsubscribe, or null if no error handler
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
  middleware?: MiddlewareConfig<any>,
): (() => void) | null {
  if (!middleware?.onSyncError) {
    return null;
  }

  const subscription = replicationState.error$.subscribe((error) => {
    if (error && middleware.onSyncError) {
      middleware.onSyncError(error instanceof Error ? error : new Error(String(error)));
    }
  });

  return () => subscription.unsubscribe();
}
