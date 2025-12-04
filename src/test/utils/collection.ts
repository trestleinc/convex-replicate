/**
 * Test utilities for collection operations
 */
import * as Y from 'yjs';
import { createTestDoc, createTestMap } from './yjs.js';

export interface TestCollection<T extends { id: string }> {
  doc: Y.Doc;
  ymap: Y.Map<unknown>;
  name: string;

  /** Insert an item into the collection */
  insert(item: T): { delta: Uint8Array };

  /** Update an item in the collection */
  update(id: string, changes: Partial<T>): { delta: Uint8Array };

  /** Delete an item from the collection */
  delete(id: string): { delta: Uint8Array };

  /** Get all items as plain objects */
  getAll(): T[];

  /** Get a single item by id */
  get(id: string): T | null;
}

/**
 * Create a mock collection for testing.
 * Simulates the client-side Y.Map collection behavior.
 */
export function createTestCollection<T extends { id: string }>(
  name: string,
  clientId?: number
): TestCollection<T> {
  const doc = createTestDoc(clientId);
  const ymap = createTestMap(doc, name);

  return {
    doc,
    ymap,
    name,

    insert(item: T): { delta: Uint8Array } {
      const beforeVector = Y.encodeStateVector(doc);

      doc.transact(() => {
        const itemMap = new Y.Map();
        for (const [key, value] of Object.entries(item)) {
          itemMap.set(key, value);
        }
        ymap.set(item.id, itemMap);
      });

      const delta = Y.encodeStateAsUpdateV2(doc, beforeVector);
      return { delta };
    },

    update(id: string, changes: Partial<T>): { delta: Uint8Array } {
      const beforeVector = Y.encodeStateVector(doc);

      doc.transact(() => {
        const itemMap = ymap.get(id);
        if (itemMap instanceof Y.Map) {
          for (const [key, value] of Object.entries(changes)) {
            itemMap.set(key, value);
          }
        }
      });

      const delta = Y.encodeStateAsUpdateV2(doc, beforeVector);
      return { delta };
    },

    delete(id: string): { delta: Uint8Array } {
      const beforeVector = Y.encodeStateVector(doc);

      doc.transact(() => {
        ymap.delete(id);
      });

      const delta = Y.encodeStateAsUpdateV2(doc, beforeVector);
      return { delta };
    },

    getAll(): T[] {
      const items: T[] = [];
      ymap.forEach((value) => {
        if (value instanceof Y.Map) {
          items.push(value.toJSON() as T);
        }
      });
      return items;
    },

    get(id: string): T | null {
      const value = ymap.get(id);
      return value instanceof Y.Map ? (value.toJSON() as T) : null;
    },
  };
}

/**
 * Sync two test collections bidirectionally.
 */
export function syncCollections<T extends { id: string }>(
  collection1: TestCollection<T>,
  collection2: TestCollection<T>
): void {
  const state1 = Y.encodeStateAsUpdateV2(collection1.doc);
  const state2 = Y.encodeStateAsUpdateV2(collection2.doc);

  Y.applyUpdateV2(collection1.doc, state2);
  Y.applyUpdateV2(collection2.doc, state1);
}
