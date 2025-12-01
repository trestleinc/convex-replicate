/**
 * Client-side history utilities
 *
 * Provides functions for comparing states (diffing) and extracting documents.
 */

import * as Y from 'yjs';

/** Result of comparing two states at the collection level */
export interface Diff {
  /** Document IDs that exist in state B but not in state A */
  added: string[];
  /** Document IDs that exist in state A but not in state B */
  removed: string[];
  /** Document IDs that exist in both but have different content */
  modified: string[];
}

/** Result of comparing fields within a document between two states */
export interface Fields {
  /** Fields that exist in B but not in A */
  added: string[];
  /** Fields that exist in A but not in B */
  removed: string[];
  /** Fields that exist in both but have different values */
  modified: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }>;
}

/**
 * Compare two states to find document-level differences.
 *
 * @param stateA - The "before" state bytes
 * @param stateB - The "after" state bytes
 * @param collection - The collection name
 * @returns Object containing added, removed, and modified document IDs
 *
 * @example
 * ```typescript
 * const changes = diff(versionA.stateBytes, versionB.stateBytes, 'tasks');
 * console.log('Added:', changes.added);
 * console.log('Modified:', changes.modified);
 * ```
 */
export function diff(stateA: Uint8Array, stateB: Uint8Array, collection: string): Diff {
  const docA = new Y.Doc({ guid: collection });
  const docB = new Y.Doc({ guid: collection });

  try {
    Y.applyUpdateV2(docA, stateA);
    Y.applyUpdateV2(docB, stateB);

    const mapA = docA.getMap(collection);
    const mapB = docB.getMap(collection);

    const keysA = new Set(mapA.keys());
    const keysB = new Set(mapB.keys());

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    // Find added documents (in B but not A)
    for (const key of keysB) {
      if (!keysA.has(key)) {
        added.push(key);
      }
    }

    // Find removed documents (in A but not B)
    for (const key of keysA) {
      if (!keysB.has(key)) {
        removed.push(key);
      }
    }

    // Find modified documents (in both but different)
    for (const key of keysA) {
      if (keysB.has(key)) {
        const itemA = mapA.get(key);
        const itemB = mapB.get(key);

        // Compare JSON representations
        const jsonA = itemA instanceof Y.Map ? itemA.toJSON() : itemA;
        const jsonB = itemB instanceof Y.Map ? itemB.toJSON() : itemB;

        if (JSON.stringify(jsonA) !== JSON.stringify(jsonB)) {
          modified.push(key);
        }
      }
    }

    return { added, removed, modified };
  } finally {
    docA.destroy();
    docB.destroy();
  }
}

/**
 * Compare fields within a specific document between two states.
 *
 * @param stateA - The "before" state bytes
 * @param stateB - The "after" state bytes
 * @param collection - The collection name
 * @param documentId - The specific document to compare
 * @returns Detailed field-level diff, or null if document doesn't exist in either state
 *
 * @example
 * ```typescript
 * const changes = fields(versionA.stateBytes, versionB.stateBytes, 'tasks', 'task-123');
 * if (changes) {
 *   changes.modified.forEach(({ field, oldValue, newValue }) => {
 *     console.log(`${field}: ${oldValue} → ${newValue}`);
 *   });
 * }
 * ```
 */
export function fields(
  stateA: Uint8Array,
  stateB: Uint8Array,
  collection: string,
  documentId: string
): Fields | null {
  const docA = new Y.Doc({ guid: collection });
  const docB = new Y.Doc({ guid: collection });

  try {
    Y.applyUpdateV2(docA, stateA);
    Y.applyUpdateV2(docB, stateB);

    const mapA = docA.getMap(collection);
    const mapB = docB.getMap(collection);

    const itemA = mapA.get(documentId);
    const itemB = mapB.get(documentId);

    // If neither exists, return null
    if (!itemA && !itemB) {
      return null;
    }

    const fieldsA = itemA instanceof Y.Map ? Object.fromEntries(itemA.entries()) : {};
    const fieldsB = itemB instanceof Y.Map ? Object.fromEntries(itemB.entries()) : {};

    const keysA = new Set(Object.keys(fieldsA));
    const keysB = new Set(Object.keys(fieldsB));

    const added: string[] = [];
    const removed: string[] = [];
    const modified: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

    // Find added fields
    for (const key of keysB) {
      if (!keysA.has(key)) {
        added.push(key);
      }
    }

    // Find removed fields
    for (const key of keysA) {
      if (!keysB.has(key)) {
        removed.push(key);
      }
    }

    // Find modified fields
    for (const key of keysA) {
      if (keysB.has(key)) {
        const valueA = fieldsA[key];
        const valueB = fieldsB[key];

        // Handle nested Y.Map values
        const jsonA = valueA instanceof Y.Map ? valueA.toJSON() : valueA;
        const jsonB = valueB instanceof Y.Map ? valueB.toJSON() : valueB;

        if (JSON.stringify(jsonA) !== JSON.stringify(jsonB)) {
          modified.push({
            field: key,
            oldValue: jsonA,
            newValue: jsonB,
          });
        }
      }
    }

    return { added, removed, modified };
  } finally {
    docA.destroy();
    docB.destroy();
  }
}

/**
 * Extract all documents from a state as plain objects.
 *
 * @param stateBytes - The state bytes
 * @param collection - The collection name
 * @returns Array of document objects with their IDs
 *
 * @example
 * ```typescript
 * const tasks = materialize<Task>(version.stateBytes, 'tasks');
 * for (const task of tasks) {
 *   console.log(task.id, task.text);
 * }
 * ```
 */
export function materialize<T extends { id: string }>(
  stateBytes: Uint8Array,
  collection: string
): T[] {
  const doc = new Y.Doc({ guid: collection });

  try {
    Y.applyUpdateV2(doc, stateBytes);
    const map = doc.getMap(collection);

    const documents: T[] = [];
    for (const [id, item] of map.entries()) {
      if (item instanceof Y.Map) {
        documents.push({ id, ...item.toJSON() } as T);
      }
    }

    return documents;
  } finally {
    doc.destroy();
  }
}

/**
 * Extract a single document from a state.
 *
 * @param stateBytes - The state bytes
 * @param collection - The collection name
 * @param documentId - The document ID to retrieve
 * @returns The document object or null if not found
 *
 * @example
 * ```typescript
 * const task = extract<Task>(version.stateBytes, 'tasks', 'task-123');
 * if (task) {
 *   console.log(task.text);
 * }
 * ```
 */
export function extract<T extends { id: string }>(
  stateBytes: Uint8Array,
  collection: string,
  documentId: string
): T | null {
  const doc = new Y.Doc({ guid: collection });

  try {
    Y.applyUpdateV2(doc, stateBytes);
    const map = doc.getMap(collection);
    const item = map.get(documentId);

    if (item instanceof Y.Map) {
      return { id: documentId, ...item.toJSON() } as T;
    }

    return null;
  } finally {
    doc.destroy();
  }
}
