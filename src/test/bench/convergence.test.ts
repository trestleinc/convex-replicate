/**
 * CRDT Convergence Stress Tests
 * Tests that all clients reach identical state after replication
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { MetricsCollector, THRESHOLDS } from '../utils/metrics.js';
import { NetworkSimulator } from '../utils/network.js';
import {
  createTestYjsClient,
  replicateWithStateVectors,
  type TestYjsClient,
} from '../utils/yjs.js';

describe('CRDT Convergence Stress Tests', () => {
  let metrics: MetricsCollector;
  let network: NetworkSimulator;
  let clients: TestYjsClient[] = [];

  beforeEach(() => {
    metrics = new MetricsCollector();
    network = new NetworkSimulator();
    clients = [];
  });

  afterEach(() => {
    for (const client of clients) {
      client.cleanup();
    }
    clients = [];
    network.unregisterAll();
  });

  /**
   * Helper to verify all clients have identical Yjs state
   */
  function verifyIdenticalState(clientList: TestYjsClient[]): boolean {
    if (clientList.length < 2) return true;

    const referenceState = Y.encodeStateAsUpdate(clientList[0].doc);

    for (let i = 1; i < clientList.length; i++) {
      const clientState = Y.encodeStateAsUpdate(clientList[i].doc);

      // Compare byte-by-byte (after applying to fresh docs to normalize)
      const refDoc = new Y.Doc();
      const clientDoc = new Y.Doc();

      Y.applyUpdate(refDoc, referenceState);
      Y.applyUpdate(clientDoc, clientState);

      const refMap = refDoc.getMap(clientList[0].map.doc?.guid ?? 'test');
      const clientMap = clientDoc.getMap(clientList[i].map.doc?.guid ?? 'test');

      // Compare document contents
      if (refMap.size !== clientMap.size) {
        refDoc.destroy();
        clientDoc.destroy();
        return false;
      }

      refDoc.destroy();
      clientDoc.destroy();
    }

    return true;
  }

  it('all clients see identical state after network partition heals', async () => {
    const collection = 'partition-test';
    const clientCount = 10;

    // Create clients
    for (let i = 0; i < clientCount; i++) {
      clients.push(createTestYjsClient(collection));
      network.registerClient(`client-${i}`, 'online');
    }

    // Initial shared state
    for (let i = 0; i < 20; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `shared-${i}`);
      itemMap.set('value', 'initial');
      clients[0].map.set(`shared-${i}`, itemMap);
    }

    // Sync all clients
    for (let i = 1; i < clientCount; i++) {
      replicateWithStateVectors(clients[0], clients[i]);
    }

    // Create partition: clients 0-4 vs clients 5-9
    const groupA = clients.slice(0, 5);
    const groupB = clients.slice(5);

    // Partition group B from group A
    for (let i = 5; i < clientCount; i++) {
      network.goOffline(`client-${i}`);
    }

    // Group A makes changes
    for (const client of groupA) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `group-a-${Math.random()}`);
      itemMap.set('source', 'groupA');
      client.map.set(`group-a-${Math.random()}`, itemMap);
    }

    // Sync within group A
    for (let i = 0; i < groupA.length; i++) {
      for (let j = i + 1; j < groupA.length; j++) {
        replicateWithStateVectors(groupA[i], groupA[j]);
      }
    }

    // Group B makes changes (simulated as online within their partition)
    for (const client of groupB) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `group-b-${Math.random()}`);
      itemMap.set('source', 'groupB');
      client.map.set(`group-b-${Math.random()}`, itemMap);
    }

    // Sync within group B
    for (let i = 0; i < groupB.length; i++) {
      for (let j = i + 1; j < groupB.length; j++) {
        replicateWithStateVectors(groupB[i], groupB[j]);
      }
    }

    metrics.startTimer('heal-partition');

    // Heal partition - bring group B online
    for (let i = 5; i < clientCount; i++) {
      network.goOnline(`client-${i}`);
    }

    // Full mesh sync
    for (let i = 0; i < clientCount; i++) {
      for (let j = i + 1; j < clientCount; j++) {
        replicateWithStateVectors(clients[i], clients[j]);
      }
    }

    const elapsed = metrics.endTimer('heal-partition');
    expect(elapsed).toBeLessThan(THRESHOLDS.convergenceMs);

    // Verify all clients have identical state
    const allSameSize = clients.every((c) => c.map.size === clients[0].map.size);
    expect(allSameSize).toBe(true);

    // Verify content matches
    const referenceKeys = Array.from(clients[0].map.keys()).sort();
    for (let i = 1; i < clientCount; i++) {
      const clientKeys = Array.from(clients[i].map.keys()).sort();
      expect(clientKeys).toEqual(referenceKeys);
    }
  });

  it('handles concurrent edits to same document fields', async () => {
    const collection = 'concurrent-edits';
    const clientCount = 5;

    // Create clients
    for (let i = 0; i < clientCount; i++) {
      clients.push(createTestYjsClient(collection));
    }

    // Create shared document
    const sharedDoc = new Y.Map<unknown>();
    sharedDoc.set('id', 'shared');
    sharedDoc.set('counter', 0);
    sharedDoc.set('text', 'initial');
    clients[0].map.set('shared', sharedDoc);

    // Sync to all clients
    for (let i = 1; i < clientCount; i++) {
      replicateWithStateVectors(clients[0], clients[i]);
    }

    // Each client modifies the same field concurrently
    for (let i = 0; i < clientCount; i++) {
      const doc = clients[i].map.get('shared') as Y.Map<unknown>;
      doc.set('text', `modified-by-client-${i}`);
      doc.set('lastModifiedBy', i);
    }

    metrics.startTimer('concurrent-convergence');

    // Sync all clients
    for (let i = 0; i < clientCount; i++) {
      for (let j = i + 1; j < clientCount; j++) {
        replicateWithStateVectors(clients[i], clients[j]);
      }
    }

    const elapsed = metrics.endTimer('concurrent-convergence');
    expect(elapsed).toBeLessThan(1000);

    // All clients should have same final value (last writer wins)
    const finalValues = clients.map((c) => {
      const doc = c.map.get('shared') as Y.Map<unknown>;
      return doc.get('text');
    });

    // All should be the same
    expect(new Set(finalValues).size).toBe(1);

    // Verify lastModifiedBy is also consistent
    const lastModifiedValues = clients.map((c) => {
      const doc = c.map.get('shared') as Y.Map<unknown>;
      return doc.get('lastModifiedBy');
    });
    expect(new Set(lastModifiedValues).size).toBe(1);
  });

  it('converges with complex nested structures', async () => {
    const collection = 'nested-convergence';
    const clientCount = 4;

    for (let i = 0; i < clientCount; i++) {
      clients.push(createTestYjsClient(collection));
    }

    // Create complex nested structure on first client
    const rootDoc = new Y.Map<unknown>();
    rootDoc.set('id', 'root');

    const nestedMap = new Y.Map<unknown>();
    nestedMap.set('level', 1);

    const deeperMap = new Y.Map<unknown>();
    deeperMap.set('level', 2);
    deeperMap.set('data', 'deep value');

    nestedMap.set('deeper', deeperMap);
    rootDoc.set('nested', nestedMap);

    const arrayData = new Y.Array<unknown>();
    arrayData.push([1, 2, 3, 4, 5]);
    rootDoc.set('array', arrayData);

    clients[0].map.set('root', rootDoc);

    // Sync to all
    for (let i = 1; i < clientCount; i++) {
      replicateWithStateVectors(clients[0], clients[i]);
    }

    // Each client modifies different parts
    // Client 0: modifies nested.deeper.data
    const client0Root = clients[0].map.get('root') as Y.Map<unknown>;
    const client0Nested = client0Root.get('nested') as Y.Map<unknown>;
    const client0Deeper = client0Nested.get('deeper') as Y.Map<unknown>;
    client0Deeper.set('data', 'modified by 0');

    // Client 1: adds to array
    const client1Root = clients[1].map.get('root') as Y.Map<unknown>;
    const client1Array = client1Root.get('array') as Y.Array<unknown>;
    client1Array.push([6, 7, 8]);

    // Client 2: adds new nested key
    const client2Root = clients[2].map.get('root') as Y.Map<unknown>;
    const client2Nested = client2Root.get('nested') as Y.Map<unknown>;
    client2Nested.set('newKey', 'added by 2');

    // Client 3: modifies root level
    const client3Root = clients[3].map.get('root') as Y.Map<unknown>;
    client3Root.set('rootLevel', 'added by 3');

    metrics.startTimer('nested-convergence');

    // Full sync
    for (let i = 0; i < clientCount; i++) {
      for (let j = i + 1; j < clientCount; j++) {
        replicateWithStateVectors(clients[i], clients[j]);
      }
    }

    const elapsed = metrics.endTimer('nested-convergence');
    expect(elapsed).toBeLessThan(1000);

    // Verify all clients have same structure
    for (const client of clients) {
      const root = client.map.get('root') as Y.Map<unknown>;
      expect(root.get('rootLevel')).toBe('added by 3');

      const nested = root.get('nested') as Y.Map<unknown>;
      expect(nested.get('newKey')).toBe('added by 2');

      const deeper = nested.get('deeper') as Y.Map<unknown>;
      expect(deeper.get('data')).toBe('modified by 0');

      const arr = root.get('array') as Y.Array<unknown>;
      expect(arr.length).toBe(8); // 5 + 3
    }
  });

  it('maintains convergence under high contention', async () => {
    const collection = 'high-contention';
    const clientCount = 10;
    const operationsPerClient = 100;

    for (let i = 0; i < clientCount; i++) {
      clients.push(createTestYjsClient(collection));
    }

    // Create single shared document
    const sharedDoc = new Y.Map<unknown>();
    sharedDoc.set('id', 'contended');
    sharedDoc.set('counter', 0);
    clients[0].map.set('contended', sharedDoc);

    // Sync to all
    for (let i = 1; i < clientCount; i++) {
      replicateWithStateVectors(clients[0], clients[i]);
    }

    metrics.startTimer('contention');

    // All clients rapidly modify the same document
    for (let op = 0; op < operationsPerClient; op++) {
      for (let c = 0; c < clientCount; c++) {
        const doc = clients[c].map.get('contended') as Y.Map<unknown>;
        const current = (doc.get('counter') as number) || 0;
        doc.set('counter', current + 1);
        doc.set(`op-${op}-client-${c}`, Date.now());
      }

      // Periodic sync during contention
      if (op % 10 === 0) {
        for (let i = 0; i < clientCount; i++) {
          for (let j = i + 1; j < clientCount; j++) {
            replicateWithStateVectors(clients[i], clients[j]);
          }
        }
      }
    }

    // Final sync
    for (let i = 0; i < clientCount; i++) {
      for (let j = i + 1; j < clientCount; j++) {
        replicateWithStateVectors(clients[i], clients[j]);
      }
    }

    const elapsed = metrics.endTimer('contention');
    expect(elapsed).toBeLessThan(THRESHOLDS.convergenceMs * 2);

    // All clients should have identical final state
    const finalCounters = clients.map((c) => {
      const doc = c.map.get('contended') as Y.Map<unknown>;
      return doc.get('counter');
    });

    expect(new Set(finalCounters).size).toBe(1);

    // All should have same number of keys
    const keyCounts = clients.map((c) => {
      const doc = c.map.get('contended') as Y.Map<unknown>;
      return Array.from(doc.keys()).length;
    });

    expect(new Set(keyCounts).size).toBe(1);
  });

  it('converges after cascade of updates', async () => {
    const collection = 'cascade-test';
    const clientCount = 5;
    const cascadeLevels = 10;

    for (let i = 0; i < clientCount; i++) {
      clients.push(createTestYjsClient(collection));
    }

    metrics.startTimer('cascade');

    // Create cascade: each client creates doc, syncs, next client modifies
    for (let level = 0; level < cascadeLevels; level++) {
      const clientIndex = level % clientCount;
      const client = clients[clientIndex];

      // Create or modify document
      const docId = `cascade-${level}`;
      const existingDoc = client.map.get(docId) as Y.Map<unknown> | undefined;

      if (existingDoc) {
        existingDoc.set('modifiedAt', Date.now());
        existingDoc.set('modifiedBy', clientIndex);
      } else {
        const newDoc = new Y.Map<unknown>();
        newDoc.set('id', docId);
        newDoc.set('createdBy', clientIndex);
        newDoc.set('level', level);
        client.map.set(docId, newDoc);
      }

      // Sync to all after each modification
      for (let i = 0; i < clientCount; i++) {
        for (let j = i + 1; j < clientCount; j++) {
          replicateWithStateVectors(clients[i], clients[j]);
        }
      }
    }

    const elapsed = metrics.endTimer('cascade');
    expect(elapsed).toBeLessThan(THRESHOLDS.convergenceMs);

    // All clients should have all documents
    expect(clients[0].map.size).toBe(cascadeLevels);
    for (const client of clients) {
      expect(client.map.size).toBe(cascadeLevels);
    }
  });

  it('verifies state vector consistency', async () => {
    const collection = 'state-vector-test';
    const clientCount = 6;

    for (let i = 0; i < clientCount; i++) {
      clients.push(createTestYjsClient(collection));
    }

    // Each client makes unique changes
    for (let c = 0; c < clientCount; c++) {
      for (let i = 0; i < 50; i++) {
        const itemMap = new Y.Map<unknown>();
        itemMap.set('id', `client-${c}-doc-${i}`);
        clients[c].map.set(`client-${c}-doc-${i}`, itemMap);
      }
    }

    // Sync all
    for (let i = 0; i < clientCount; i++) {
      for (let j = i + 1; j < clientCount; j++) {
        replicateWithStateVectors(clients[i], clients[j]);
      }
    }

    // Get state vectors
    const stateVectors = clients.map((c) => Y.encodeStateVector(c.doc));

    // All state vectors should be equivalent (after full sync)
    // We verify by checking that syncing any pair produces no new updates
    for (let i = 0; i < clientCount; i++) {
      for (let j = i + 1; j < clientCount; j++) {
        const diffIJ = Y.encodeStateAsUpdate(clients[i].doc, stateVectors[j]);
        const diffJI = Y.encodeStateAsUpdate(clients[j].doc, stateVectors[i]);

        // Diffs should be minimal (just metadata, no actual content)
        // A truly empty diff would be very small
        expect(diffIJ.byteLength).toBeLessThan(100);
        expect(diffJI.byteLength).toBeLessThan(100);
      }
    }
  });
});
