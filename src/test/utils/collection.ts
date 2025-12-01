/**
 * Collection Testing Helpers
 * Utilities for testing the full replicate flow with SSR, subscriptions, and reconnection
 */

import * as Y from 'yjs';
import type { CheckpointData } from '$/client/services/checkpoint.js';

// Re-export for convenience (avoid breaking imports)
type Checkpoint = CheckpointData;

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
 * Test client that can make mutations and track received updates
 * Internal - used by simulateClientServerReplicate
 */
interface TestReplicateClient<T extends { id: string }> {
  id: string;
  ydoc: Y.Doc;
  ymap: Y.Map<Y.Map<unknown>>;
  receivedDeltas: Array<{
    delta: Uint8Array;
    documentId: string;
    timestamp: number;
  }>;
  makeMutation: (item: T) => {
    delta: Uint8Array;
    documentId: string;
    timestamp: number;
  };
  applyDelta: (delta: Uint8Array) => void;
  getItems: () => T[];
  destroy: () => void;
}

/**
 * Create a test replicate client for simulating multi-client scenarios
 * Internal - used by simulateClientServerReplicate
 */
function createTestReplicateClient<T extends { id: string }>(
  clientId: string,
  collection: string
): TestReplicateClient<T> {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap<Y.Map<unknown>>(collection);
  const receivedDeltas: TestReplicateClient<T>['receivedDeltas'] = [];

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
 * Internal - used by simulateClientServerReplicate
 */
interface MockReplicateServer<_T extends { id: string }> {
  deltas: Array<{
    delta: Uint8Array;
    documentId: string;
    timestamp: number;
    fromClient: string;
  }>;
  checkpoint: Checkpoint;
  receiveMutation: (
    fromClient: string,
    mutation: { delta: Uint8Array; documentId: string; timestamp: number }
  ) => void;
  getDeltasSince: (checkpoint: Checkpoint) => Array<{
    delta: Uint8Array;
    documentId: string;
    timestamp: number;
    fromClient: string;
  }>;
  getSSRData: (collection: string) => {
    crdtBytes: ArrayBuffer;
    checkpoint: Checkpoint;
  };
}

/**
 * Create a mock replicate server for testing multi-client scenarios
 * Internal - used by simulateClientServerReplicate
 */
function createMockReplicateServer<T extends { id: string }>(_: string): MockReplicateServer<T> {
  const deltas: MockReplicateServer<T>['deltas'] = [];
  let checkpoint: Checkpoint = { lastModified: 0 };
  let timestampCounter = 1000;

  return {
    deltas,
    checkpoint,

    receiveMutation: (fromClient, mutation) => {
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
      if (deltas.length === 0) {
        return {
          crdtBytes: new ArrayBuffer(0),
          checkpoint: { lastModified: 0 },
        };
      }

      const merged = Y.mergeUpdatesV2(deltas.map((d) => d.delta));

      return {
        crdtBytes: merged.buffer as ArrayBuffer,
        checkpoint,
      };
    },
  };
}

/**
 * Simulate a full replicate scenario between two clients via a server
 */
export function simulateClientServerReplicate<T extends { id: string }>(
  collection: string
): {
  clientA: TestReplicateClient<T>;
  clientB: TestReplicateClient<T>;
  server: MockReplicateServer<T>;
  clientAMutates: (item: T) => void;
  clientBMutates: (item: T) => void;
  replicateToClientA: () => void;
  replicateToClientB: () => void;
  destroy: () => void;
} {
  const clientA = createTestReplicateClient<T>('A', collection);
  const clientB = createTestReplicateClient<T>('B', collection);
  const server = createMockReplicateServer<T>(collection);

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

    replicateToClientA: () => {
      const checkpoint = clientCheckpoints.get('A') ?? { lastModified: 0 };
      const newDeltas = server.getDeltasSince(checkpoint);

      for (const delta of newDeltas) {
        if (delta.fromClient !== 'A') {
          clientA.applyDelta(delta.delta);
        }
      }

      if (newDeltas.length > 0) {
        const lastDelta = newDeltas[newDeltas.length - 1];
        clientCheckpoints.set('A', { lastModified: lastDelta.timestamp });
      }
    },

    replicateToClientB: () => {
      const checkpoint = clientCheckpoints.get('B') ?? { lastModified: 0 };
      const newDeltas = server.getDeltasSince(checkpoint);

      for (const delta of newDeltas) {
        if (delta.fromClient !== 'B') {
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
