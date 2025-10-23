/**
 * CRDT (Conflict-free Replicated Data Types) Support for ConvexRx
 *
 * CRDTs allow automatic conflict resolution at the operation level,
 * making them ideal for collaborative applications where multiple users
 * edit the same document simultaneously.
 *
 * @example
 * ```typescript
 * // Client A increments counter
 * await doc.updateCRDT({ ifMatch: { $inc: { points: 1 } } });
 *
 * // Client B increments counter (offline)
 * await doc.updateCRDT({ ifMatch: { $inc: { points: 1 } } });
 *
 * // After sync: points = 2 ✅ Both operations preserved
 * ```
 */

import { RxDBcrdtPlugin, getCRDTSchemaPart } from 'rxdb/plugins/crdt';
import { addRxPlugin } from 'rxdb';
import type { RxJsonSchema } from './types';
import type { SyncedDocument } from './types';

// Add CRDT plugin to RxDB
addRxPlugin(RxDBcrdtPlugin);

// ========================================
// SCHEMA HELPERS
// ========================================

/**
 * Adds CRDT field to an existing schema.
 * This field stores CRDT operations for conflict-free replication.
 *
 * @param schema - The base schema to enhance with CRDT support
 * @returns Enhanced schema with CRDT field and configuration
 *
 * @example
 * ```typescript
 * const baseSchema = createSchema('tasks', {
 *   text: property.string(),
 *   isCompleted: property.boolean(),
 * });
 *
 * const crdtSchema = addCRDTToSchema(baseSchema);
 * ```
 */
export function addCRDTToSchema<T extends SyncedDocument>(
  schema: RxJsonSchema<T>
): RxJsonSchema<T & { crdts?: any }> {
  return {
    ...schema,
    properties: {
      ...schema.properties,
      crdts: getCRDTSchemaPart(),
    },
    crdt: {
      field: 'crdts',
    },
  } as RxJsonSchema<T & { crdts?: any }>;
}

// ========================================
// CRDT ACTION BUILDERS
// ========================================

/**
 * CRDT-aware actions for conflict-free updates
 */
export interface CRDTActions<TData> {
  /**
   * Update document using CRDT operations
   *
   * @example
   * ```typescript
   * await actions.updateCRDT('task-1', {
   *   $set: { text: 'New text' },
   *   $inc: { points: 5 }
   * });
   * ```
   */
  updateCRDT: (
    id: string,
    operations: {
      $set?: Partial<TData>;
      $inc?: Partial<Record<keyof TData, number>>;
    }
  ) => Promise<void>;

  /**
   * Toggle a boolean field using CRDT
   *
   * @example
   * ```typescript
   * await actions.toggleCRDT('task-1', 'isCompleted');
   * ```
   */
  toggleCRDT: (id: string, field: keyof TData) => Promise<void>;

  /**
   * Increment a numeric field using CRDT
   *
   * @example
   * ```typescript
   * await actions.incrementCRDT('task-1', 'points', 5);
   * ```
   */
  incrementCRDT: (id: string, field: keyof TData, amount?: number) => Promise<void>;
}

/**
 * Creates CRDT-aware actions for a collection.
 * These actions use CRDT operations for conflict-free updates.
 *
 * @param rxCollection - The RxDB collection
 * @returns Object with CRDT action methods
 *
 * @example
 * ```typescript
 * const crdtActions = createCRDTActions<Task>(ctx.rxCollection);
 *
 * // Use CRDT operations
 * await crdtActions.toggleCRDT('task-1', 'isCompleted');
 * await crdtActions.incrementCRDT('task-1', 'points', 10);
 * ```
 */
export function createCRDTActions<TData extends SyncedDocument>(
  rxCollection: any
): CRDTActions<TData> {
  return {
    async updateCRDT(id, operations) {
      const doc = await rxCollection.findOne(id).exec();
      if (!doc) {
        throw new Error(`Document ${id} not found`);
      }

      await doc.updateCRDT({
        ifMatch: operations,
      });
    },

    async toggleCRDT(id, field) {
      const doc = await rxCollection.findOne(id).exec();
      if (!doc) {
        throw new Error(`Document ${id} not found`);
      }

      const currentValue = doc.get(field as string);
      await doc.updateCRDT({
        ifMatch: {
          $set: { [field]: !currentValue },
        },
      });
    },

    async incrementCRDT(id, field, amount = 1) {
      const doc = await rxCollection.findOne(id).exec();
      if (!doc) {
        throw new Error(`Document ${id} not found`);
      }

      await doc.updateCRDT({
        ifMatch: {
          $inc: { [field]: amount },
        },
      });
    },
  };
}

// ========================================
// EXPORTS
// ========================================

export { getCRDTSchemaPart };
