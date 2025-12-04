/**
 * Test utilities for Yjs operations
 */
import * as Y from 'yjs';

/**
 * Create a Y.Doc for testing.
 * Disables garbage collection for predictable test behavior.
 */
export function createTestDoc(clientId?: number): Y.Doc {
  return new Y.Doc({
    gc: false,
    clientID: clientId ?? Math.floor(Math.random() * 2147483647),
  });
}

/**
 * Create a Y.Map with initial data for testing.
 */
export function createTestMap<T extends Record<string, unknown>>(
  doc: Y.Doc,
  name: string,
  initialData?: Record<string, T>
): Y.Map<unknown> {
  const ymap = doc.getMap(name);
  if (initialData) {
    doc.transact(() => {
      for (const [key, value] of Object.entries(initialData)) {
        const itemMap = new Y.Map();
        for (const [field, fieldValue] of Object.entries(value)) {
          itemMap.set(field, fieldValue);
        }
        ymap.set(key, itemMap);
      }
    });
  }
  return ymap;
}

/**
 * Sync two Y.Docs bidirectionally.
 * Simulates network sync between two clients.
 */
export function syncDocs(doc1: Y.Doc, doc2: Y.Doc): void {
  const state1 = Y.encodeStateAsUpdateV2(doc1);
  const state2 = Y.encodeStateAsUpdateV2(doc2);

  Y.applyUpdateV2(doc1, state2);
  Y.applyUpdateV2(doc2, state1);
}

/**
 * Get delta between two document states.
 */
export function getDelta(doc: Y.Doc, beforeVector: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdateV2(doc, beforeVector);
}

/**
 * Create a delta from a single document by capturing changes in a transaction.
 */
export function captureChanges<T>(doc: Y.Doc, fn: () => T): { result: T; delta: Uint8Array } {
  const beforeVector = Y.encodeStateVector(doc);
  const result = doc.transact(fn);
  const delta = Y.encodeStateAsUpdateV2(doc, beforeVector);
  return { result, delta };
}

/**
 * Apply an update to a document.
 */
export function applyUpdate(doc: Y.Doc, update: Uint8Array, origin?: string): void {
  Y.applyUpdateV2(doc, update, origin);
}

/**
 * Create a test item structure (matching replicate's internal format).
 */
export function createTestItem(
  id: string,
  fields: Record<string, unknown>
): Record<string, unknown> {
  return {
    id,
    ...fields,
  };
}
