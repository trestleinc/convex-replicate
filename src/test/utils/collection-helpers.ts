/**
 * Collection Testing Helpers
 * Utilities for testing the full sync flow with SSR, subscriptions, and reconnection
 */

import * as Y from 'yjs';
import type { Checkpoint } from '../../client/services/CheckpointService.js';

/**
 * Generate SSR-like data from a list of items
 * Simulates what the server's getInitialState would return
 */
export function createTestSSRData<T extends { id: string }>(
  collection: string,
  items: T[]
): {
  documents: T[];
  crdtBytes: ArrayBuffer;
  checkpoint: Checkpoint;
} {
  // Create a Yjs document and populate it
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap<Y.Map<unknown>>(collection);

  // Add each item to the Yjs document
  for (const item of items) {
    const itemMap = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(item)) {
      itemMap.set(key, value);
    }
    ymap.set(item.id, itemMap);
  }

  // Encode as V2 update (matching what server should send)
  const crdtBytes = Y.encodeStateAsUpdateV2(ydoc);

  // Generate a realistic checkpoint (max timestamp of items)
  const checkpoint: Checkpoint = {
    lastModified: Date.now(),
  };

  ydoc.destroy();

  return {
    documents: items,
    crdtBytes: crdtBytes.buffer as ArrayBuffer,
    checkpoint,
  };
}

/**
 * Create a delta representing a single item change
 * Simulates what the server would send for a mutation
 */
export function createTestDelta<T extends { id: string }>(
  collection: string,
  item: T,
  baseDoc?: Y.Doc
): {
  crdtBytes: ArrayBuffer;
  documentId: string;
  timestamp: number;
} {
  // Create or use existing doc
  const ydoc = baseDoc || new Y.Doc();
  const ymap = ydoc.getMap<Y.Map<unknown>>(collection);

  // Capture state before change
  const beforeVector = Y.encodeStateVector(ydoc);

  // Apply the change
  const itemMap = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(item)) {
    itemMap.set(key, value);
  }
  ymap.set(item.id, itemMap);

  // Capture delta (only the change)
  const delta = Y.encodeStateAsUpdateV2(ydoc, beforeVector);

  if (!baseDoc) {
    ydoc.destroy();
  }

  return {
    crdtBytes: delta.buffer as ArrayBuffer,
    documentId: item.id,
    timestamp: Date.now(),
  };
}

/**
 * Create a subscription response with a delta change
 */
export function createDeltaResponse(
  delta: { crdtBytes: ArrayBuffer; documentId: string; timestamp: number },
  checkpoint: Checkpoint
): {
  changes: Array<{
    operationType: 'delta';
    crdtBytes: ArrayBuffer;
    documentId: string;
  }>;
  checkpoint: Checkpoint;
} {
  return {
    changes: [
      {
        operationType: 'delta',
        crdtBytes: delta.crdtBytes,
        documentId: delta.documentId,
      },
    ],
    checkpoint,
  };
}

/**
 * Test client that can make mutations and track received updates
 */
export interface TestSyncClient<T extends { id: string }> {
  id: string;
  ydoc: Y.Doc;
  ymap: Y.Map<Y.Map<unknown>>;
  receivedDeltas: Array<{
    delta: Uint8Array;
    documentId: string;
    timestamp: number;
  }>;

  // Make a mutation and return the delta
  makeMutation: (item: T) => {
    delta: Uint8Array;
    documentId: string;
    timestamp: number;
  };

  // Apply a delta from another client
  applyDelta: (delta: Uint8Array) => void;

  // Get current items as plain objects
  getItems: () => T[];

  // Cleanup
  destroy: () => void;
}

/**
 * Create a test sync client for simulating multi-client scenarios
 */
export function createTestSyncClient<T extends { id: string }>(
  clientId: string,
  collection: string
): TestSyncClient<T> {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap<Y.Map<unknown>>(collection);
  const receivedDeltas: TestSyncClient<T>['receivedDeltas'] = [];

  return {
    id: clientId,
    ydoc,
    ymap,
    receivedDeltas,

    makeMutation: (item: T) => {
      const beforeVector = Y.encodeStateVector(ydoc);

      // Apply the change
      const itemMap = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(item)) {
        itemMap.set(key, value);
      }
      ymap.set(item.id, itemMap);

      // Capture delta
      const delta = Y.encodeStateAsUpdateV2(ydoc, beforeVector);

      return {
        delta,
        documentId: item.id,
        timestamp: Date.now(),
      };
    },

    applyDelta: (delta: Uint8Array) => {
      Y.applyUpdateV2(ydoc, delta);
    },

    getItems: () => {
      const items: T[] = [];
      ymap.forEach((itemMap) => {
        if (itemMap instanceof Y.Map) {
          items.push(itemMap.toJSON() as T);
        }
      });
      return items;
    },

    destroy: () => {
      ydoc.destroy();
    },
  };
}

/**
 * Mock server that routes deltas between clients
 */
export interface MockSyncServer<T extends { id: string }> {
  // All deltas stored on server (event log)
  deltas: Array<{
    delta: Uint8Array;
    documentId: string;
    timestamp: number;
    fromClient: string;
  }>;

  // Current checkpoint (max timestamp)
  checkpoint: Checkpoint;

  // Receive a mutation from a client
  receiveMutation: (
    fromClient: string,
    mutation: { delta: Uint8Array; documentId: string; timestamp: number }
  ) => void;

  // Get deltas since a checkpoint (simulates stream query)
  getDeltasSince: (checkpoint: Checkpoint) => Array<{
    delta: Uint8Array;
    documentId: string;
    timestamp: number;
    fromClient: string;
  }>;

  // Get SSR data (simulates getInitialState)
  getSSRData: (collection: string) => {
    crdtBytes: ArrayBuffer;
    checkpoint: Checkpoint;
  };
}

/**
 * Create a mock sync server for testing multi-client scenarios
 */
export function createMockSyncServer<T extends { id: string }>(
  collection: string
): MockSyncServer<T> {
  const deltas: MockSyncServer<T>['deltas'] = [];
  let checkpoint: Checkpoint = { lastModified: 0 };
  // Use incrementing counter for unique, deterministic timestamps
  let timestampCounter = 1000;

  return {
    deltas,
    checkpoint,

    receiveMutation: (fromClient, mutation) => {
      // Server assigns timestamp (incrementing for uniqueness in tests)
      const serverTimestamp = ++timestampCounter;
      deltas.push({
        ...mutation,
        timestamp: serverTimestamp,
        fromClient,
      });
      checkpoint = { lastModified: serverTimestamp };
    },

    getDeltasSince: (since) => {
      return deltas.filter((d) => d.timestamp > since.lastModified);
    },

    getSSRData: () => {
      // Merge all deltas into a single update
      if (deltas.length === 0) {
        return {
          crdtBytes: new ArrayBuffer(0),
          checkpoint: { lastModified: 0 },
        };
      }

      // Use V2 merge for consistency
      const merged = Y.mergeUpdatesV2(deltas.map((d) => d.delta));

      return {
        crdtBytes: merged.buffer as ArrayBuffer,
        checkpoint,
      };
    },
  };
}

/**
 * Simulate a full sync scenario between two clients via a server
 */
export function simulateClientServerSync<T extends { id: string }>(
  collection: string
): {
  clientA: TestSyncClient<T>;
  clientB: TestSyncClient<T>;
  server: MockSyncServer<T>;

  // Client A makes a mutation, server receives it
  clientAMutates: (item: T) => void;

  // Client B makes a mutation, server receives it
  clientBMutates: (item: T) => void;

  // Sync client A from server (like subscription update)
  syncClientA: () => void;

  // Sync client B from server
  syncClientB: () => void;

  // Cleanup
  destroy: () => void;
} {
  const clientA = createTestSyncClient<T>('A', collection);
  const clientB = createTestSyncClient<T>('B', collection);
  const server = createMockSyncServer<T>(collection);

  // Track last synced checkpoint per client
  const clientCheckpoints = new Map<string, Checkpoint>([
    ['A', { lastModified: 0 }],
    ['B', { lastModified: 0 }],
  ]);

  return {
    clientA,
    clientB,
    server,

    clientAMutates: (item: T) => {
      const mutation = clientA.makeMutation(item);
      server.receiveMutation('A', mutation);
    },

    clientBMutates: (item: T) => {
      const mutation = clientB.makeMutation(item);
      server.receiveMutation('B', mutation);
    },

    syncClientA: () => {
      const checkpoint = clientCheckpoints.get('A')!;
      const newDeltas = server.getDeltasSince(checkpoint);

      for (const delta of newDeltas) {
        if (delta.fromClient !== 'A') {
          // Only apply deltas from other clients
          clientA.applyDelta(delta.delta);
        }
      }

      if (newDeltas.length > 0) {
        const lastDelta = newDeltas[newDeltas.length - 1];
        clientCheckpoints.set('A', { lastModified: lastDelta.timestamp });
      }
    },

    syncClientB: () => {
      const checkpoint = clientCheckpoints.get('B')!;
      const newDeltas = server.getDeltasSince(checkpoint);

      for (const delta of newDeltas) {
        if (delta.fromClient !== 'B') {
          // Only apply deltas from other clients
          clientB.applyDelta(delta.delta);
        }
      }

      if (newDeltas.length > 0) {
        const lastDelta = newDeltas[newDeltas.length - 1];
        clientCheckpoints.set('B', { lastModified: lastDelta.timestamp });
      }
    },

    destroy: () => {
      clientA.destroy();
      clientB.destroy();
    },
  };
}
