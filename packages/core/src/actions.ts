/**
 * Base CRUD action factory.
 *
 * Creates standardized insert/update/delete operations for ConvexRx.
 * Framework-agnostic - works with any reactive collection wrapper.
 */

import type { RxCollection } from 'rxdb';
import type { BaseActions, SyncedDocument } from './types';
import { getLogger } from './logger';

let clockSkew = 0;

export function setServerTime(serverTime: number): void {
  clockSkew = serverTime - Date.now();
}

export function getAdjustedTime(): number {
  return Date.now() + clockSkew;
}

/**
 * Action context providing the primitives needed for CRUD operations.
 * Framework packages provide their own implementations of insert/update functions.
 *
 * @template TData - Document type extending SyncedDocument
 */
export interface ActionContext<TData extends SyncedDocument> {
  /** RxDB collection for direct queries and soft deletes */
  rxCollection: RxCollection<TData>;

  /**
   * Insert function from the collection wrapper.
   * Different per framework (TanStack DB in React, Svelte stores, etc.)
   */
  insertFn: (doc: TData) => Promise<void>;

  /**
   * Update function from the collection wrapper.
   * Receives document ID and updater function.
   * Different per framework (TanStack DB in React, Svelte stores, etc.)
   */
  updateFn: (id: string, updater: (draft: TData) => void) => Promise<void>;
}

/**
 * Create base CRUD actions from an action context.
 *
 * This factory function encapsulates the standard ConvexRx CRUD logic:
 * - Insert: Generate UUID, add timestamp, use wrapper's insert
 * - Update: Merge updates, update timestamp, use wrapper's update
 * - Delete: Soft delete via RxDB, set _deleted flag
 *
 * @param context - Action context with collection and insert/update functions
 * @returns Base actions (insert, update, delete)
 *
 * @example React (TanStack DB)
 * ```typescript
 * const baseActions = createBaseActions({
 *   rxCollection: syncInstance.rxCollection,
 *   insertFn: (doc) => collection.insert(doc),
 *   updateFn: (id, updater) => collection.update(id, updater),
 * });
 * ```
 *
 * @example Svelte (custom store)
 * ```typescript
 * const baseActions = createBaseActions({
 *   rxCollection: syncInstance.rxCollection,
 *   insertFn: async (doc) => {
 *     await rxCollection.insert(doc);
 *   },
 *   updateFn: async (id, updater) => {
 *     const doc = await rxCollection.findOne(id).exec();
 *     if (doc) {
 *       const draft = { ...doc.toJSON() };
 *       updater(draft);
 *       await doc.update({ $set: draft });
 *     }
 *   },
 * });
 * ```
 */
export function createBaseActions<TData extends SyncedDocument>(
  context: ActionContext<TData>
): BaseActions<TData> {
  return {
    insert: async (doc: Omit<TData, keyof SyncedDocument>): Promise<string> => {
      const logger = getLogger('actions', false);

      let id = crypto.randomUUID();
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        const existing = await context.rxCollection.findOne(id).exec();
        if (!existing) break;

        logger.warn('UUID collision detected, regenerating', { id, attempt: attempts + 1 });
        id = crypto.randomUUID();
        attempts++;
      }

      if (attempts === maxAttempts) {
        throw new Error('Failed to generate unique UUID after multiple attempts');
      }

      const fullDoc = {
        ...doc,
        id,
        updatedTime: getAdjustedTime(),
      } as TData;

      await context.insertFn(fullDoc);
      return id;
    },

    /**
     * Update an existing document.
     * Merges updates, updates timestamp, calls wrapper's update function.
     */
    update: async (
      id: string,
      updates: Partial<Omit<TData, keyof SyncedDocument>>
    ): Promise<void> => {
      await context.updateFn(id, (draft: TData) => {
        Object.assign(draft, updates);
        draft.updatedTime = getAdjustedTime();
      });
    },

    /**
     * Soft delete a document.
     * Uses RxDB directly to set _deleted flag.
     * This ensures soft deletes work consistently across all frameworks.
     */
    delete: async (id: string): Promise<void> => {
      const doc = await context.rxCollection.findOne(id).exec();

      if (doc) {
        await doc.update({
          $set: {
            _deleted: true,
            updatedTime: getAdjustedTime(),
          },
        });
      } else {
        throw new Error(`Document ${id} not found`);
      }
    },
  };
}
