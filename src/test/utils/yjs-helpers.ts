/**
 * Yjs Testing Helpers
 * Utilities for creating and synchronizing Yjs documents in tests
 */

import * as Y from 'yjs';

export interface TestYjsClient {
  doc: Y.Doc;
  map: Y.Map<unknown>;
  updates: Uint8Array[];
  cleanup: () => void;
}

/**
 * Create a test Yjs client with update tracking
 */
export function createTestYjsClient(collection: string): TestYjsClient {
  const doc = new Y.Doc();
  const map = doc.getMap(collection);
  const updates: Uint8Array[] = [];

  const updateHandler = (update: Uint8Array) => {
    updates.push(update);
  };

  doc.on('update', updateHandler);

  return {
    doc,
    map,
    updates,
    cleanup: () => {
      doc.off('update', updateHandler);
      doc.destroy();
    },
  };
}

/**
 * Synchronize two Yjs clients by applying all pending updates
 */
export function syncYjsClients(clientA: TestYjsClient, clientB: TestYjsClient): void {
  // Apply A's updates to B
  for (const update of clientA.updates) {
    Y.applyUpdate(clientB.doc, update);
  }

  // Apply B's updates to A
  for (const update of clientB.updates) {
    Y.applyUpdate(clientA.doc, update);
  }

  // Clear applied updates
  clientA.updates.length = 0;
  clientB.updates.length = 0;
}

/**
 * Setup bidirectional sync between two Yjs clients
 */
export function setupBidirectionalSync(clientA: TestYjsClient, clientB: TestYjsClient): () => void {
  const handlerA = (update: Uint8Array) => {
    Y.applyUpdate(clientB.doc, update);
  };

  const handlerB = (update: Uint8Array) => {
    Y.applyUpdate(clientA.doc, update);
  };

  clientA.doc.on('update', handlerA);
  clientB.doc.on('update', handlerB);

  return () => {
    clientA.doc.off('update', handlerA);
    clientB.doc.off('update', handlerB);
  };
}

/**
 * Encode full document state as update
 */
export function encodeDocumentState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Sync clients using state vectors (efficient)
 */
export function syncWithStateVectors(clientA: TestYjsClient, clientB: TestYjsClient): void {
  const stateVectorA = Y.encodeStateVector(clientA.doc);
  const stateVectorB = Y.encodeStateVector(clientB.doc);

  const diffA = Y.encodeStateAsUpdate(clientA.doc, stateVectorB);
  const diffB = Y.encodeStateAsUpdate(clientB.doc, stateVectorA);

  Y.applyUpdate(clientA.doc, diffB);
  Y.applyUpdate(clientB.doc, diffA);
}
