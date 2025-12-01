/**
 * Merge Helpers - Plain functions for Yjs CRDT operations
 *
 * Provides document creation, state encoding, and merge operations.
 */

import { get as idbGet, set as idbSet } from 'idb-keyval';
import * as Y from 'yjs';
import { getLogger } from '$/client/logger.js';

const logger = getLogger(['replicate', 'merge']);

/**
 * Create a Yjs document with a persistent clientId stored in IndexedDB.
 * The clientId ensures consistent identity across sessions for CRDT merging.
 */
export async function createYjsDocument(collection: string): Promise<Y.Doc> {
  const clientIdKey = `yjsClientId:${collection}`;
  let clientId = await idbGet<number>(clientIdKey);

  if (!clientId) {
    clientId = Math.floor(Math.random() * 2147483647);
    await idbSet(clientIdKey, clientId);
    logger.info('Generated new Yjs clientID', { collection, clientId });
  }

  const ydoc = new Y.Doc({
    guid: collection,
    clientID: clientId,
  } as any);

  logger.info('Created Yjs document', { collection, clientId });
  return ydoc;
}

/**
 * Apply a binary update to a Yjs document.
 * @param transact - Whether to wrap in a transaction (default: true)
 */
export function applyUpdate(
  doc: Y.Doc,
  update: Uint8Array,
  origin?: string,
  transact = true
): void {
  if (transact) {
    doc.transact(() => {
      Y.applyUpdateV2(doc, update, origin);
    }, origin);
  } else {
    Y.applyUpdateV2(doc, update, origin);
  }
}

/**
 * Get a Y.Map from a Yjs document by name.
 */
export function getYMap<T = unknown>(doc: Y.Doc, name: string): Y.Map<T> {
  return doc.getMap(name);
}

/**
 * Execute a function within a Yjs transaction.
 */
export function yjsTransact<A>(doc: Y.Doc, fn: () => A, origin?: string): A {
  return doc.transact(fn, origin);
}

/**
 * Execute a function within a Yjs transaction and capture the delta.
 * Returns both the function result and a delta containing only the changes made.
 */
export function transactWithDelta<A>(
  doc: Y.Doc,
  fn: () => A,
  origin?: string
): { result: A; delta: Uint8Array } {
  const beforeVector = Y.encodeStateVector(doc);
  const result = doc.transact(fn, origin);
  const delta = Y.encodeStateAsUpdateV2(doc, beforeVector);
  return { result, delta };
}

/**
 * Extract all items from a Y.Map as plain objects.
 */
export function extractItems<T>(ymap: Y.Map<unknown>): T[] {
  const items: T[] = [];
  ymap.forEach((value) => {
    if (value instanceof Y.Map) {
      items.push(value.toJSON() as T);
    }
  });
  return items;
}

/**
 * Extract a single item from a Y.Map by key.
 */
export function extractItem<T>(ymap: Y.Map<unknown>, key: string): T | null {
  const value = ymap.get(key);
  return value instanceof Y.Map ? (value.toJSON() as T) : null;
}
