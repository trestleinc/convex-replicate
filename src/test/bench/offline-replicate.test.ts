/**
 * Offline Replicate Stress Tests
 * Tests offline mutation queueing and replication on reconnect
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { MetricsCollector } from '../utils/metrics.js';
import { NetworkSimulator } from '../utils/network.js';
import {
  createTestYjsClient,
  replicateWithStateVectors,
  type TestYjsClient,
} from '../utils/yjs.js';

describe('Offline Replicate Stress Tests', () => {
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

  it('queues 500 mutations while offline and replicates on reconnect', async () => {
    const mutationCount = 500;
    const collection = 'offline-test';

    // Create client and server
    const client = createTestYjsClient(collection);
    const server = createTestYjsClient(collection);
    clients.push(client, server);

    network.registerClient('client', 'online');

    // Go offline
    network.goOffline('client');
    expect(network.isOffline('client')).toBe(true);

    // Queue mutations while offline
    metrics.startTimer('offline-mutations');
    for (let i = 0; i < mutationCount; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `offline-${i}`);
      itemMap.set('value', i);
      itemMap.set('timestamp', Date.now());
      client.map.set(`offline-${i}`, itemMap);
    }
    metrics.endTimer('offline-mutations');

    expect(client.map.size).toBe(mutationCount);
    expect(server.map.size).toBe(0); // Server hasn't received anything

    // Go online and replicate
    network.goOnline('client');
    expect(network.isOnline('client')).toBe(true);

    metrics.startTimer('replicate');
    replicateWithStateVectors(client, server);
    const replicateTime = metrics.endTimer('replicate');

    expect(replicateTime).toBeLessThan(10000); // 10 seconds for 500 ops
    expect(server.map.size).toBe(mutationCount);

    // Verify all data replicated correctly
    for (let i = 0; i < mutationCount; i++) {
      const serverItem = server.map.get(`offline-${i}`) as Y.Map<unknown>;
      expect(serverItem).toBeDefined();
      expect(serverItem.get('id')).toBe(`offline-${i}`);
    }
  });

  it('merges conflicting offline changes from multiple clients', async () => {
    const collection = 'conflict-test';

    // Create three participants: two clients and a server
    const clientA = createTestYjsClient(collection);
    const clientB = createTestYjsClient(collection);
    const server = createTestYjsClient(collection);
    clients.push(clientA, clientB, server);

    network.registerClient('clientA', 'online');
    network.registerClient('clientB', 'online');

    // Seed some shared data
    for (let i = 0; i < 10; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `shared-${i}`);
      itemMap.set('value', 'initial');
      server.map.set(`shared-${i}`, itemMap);
    }

    // Sync to clients
    replicateWithStateVectors(server, clientA);
    replicateWithStateVectors(server, clientB);

    // Both clients go offline
    network.goOffline('clientA');
    network.goOffline('clientB');

    // ClientA modifies documents
    for (let i = 0; i < 10; i++) {
      const item = clientA.map.get(`shared-${i}`) as Y.Map<unknown>;
      item.set('value', 'modified-by-A');
      item.set('modifiedBy', 'clientA');
    }

    // ClientB also modifies the same documents
    for (let i = 0; i < 10; i++) {
      const item = clientB.map.get(`shared-${i}`) as Y.Map<unknown>;
      item.set('value', 'modified-by-B');
      item.set('modifiedBy', 'clientB');
    }

    // Both clients add new documents
    for (let i = 0; i < 20; i++) {
      const itemA = new Y.Map<unknown>();
      itemA.set('id', `a-new-${i}`);
      clientA.map.set(`a-new-${i}`, itemA);

      const itemB = new Y.Map<unknown>();
      itemB.set('id', `b-new-${i}`);
      clientB.map.set(`b-new-${i}`, itemB);
    }

    // Clients reconnect and sync with server
    network.goOnline('clientA');
    network.goOnline('clientB');

    metrics.startTimer('conflict-resolution');

    replicateWithStateVectors(clientA, server);
    replicateWithStateVectors(clientB, server);

    // Sync back to both clients
    replicateWithStateVectors(server, clientA);
    replicateWithStateVectors(server, clientB);

    const elapsed = metrics.endTimer('conflict-resolution');
    expect(elapsed).toBeLessThan(5000);

    // All clients should have same document count
    // 10 shared + 20 from A + 20 from B = 50
    const expectedCount = 10 + 20 + 20;
    expect(server.map.size).toBe(expectedCount);
    expect(clientA.map.size).toBe(expectedCount);
    expect(clientB.map.size).toBe(expectedCount);

    // Verify CRDT merge - last writer wins per field
    // Both clients modified same docs, so one should "win"
    for (let i = 0; i < 10; i++) {
      const serverItem = server.map.get(`shared-${i}`) as Y.Map<unknown>;
      const clientAItem = clientA.map.get(`shared-${i}`) as Y.Map<unknown>;
      const clientBItem = clientB.map.get(`shared-${i}`) as Y.Map<unknown>;

      // All should have same value after merge
      expect(serverItem.get('value')).toBe(clientAItem.get('value'));
      expect(serverItem.get('value')).toBe(clientBItem.get('value'));
    }
  });

  it('handles long offline period with many changes', async () => {
    const collection = 'long-offline-test';
    const offlineMutations = 1000;

    const client = createTestYjsClient(collection);
    const server = createTestYjsClient(collection);
    clients.push(client, server);

    network.registerClient('client', 'online');

    // Initial sync
    for (let i = 0; i < 100; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `initial-${i}`);
      server.map.set(`initial-${i}`, itemMap);
    }
    replicateWithStateVectors(server, client);

    // Go offline for "extended period"
    network.goOffline('client');

    // Simulate extended offline work
    metrics.startTimer('offline-period');
    for (let i = 0; i < offlineMutations; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `offline-work-${i}`);
      itemMap.set('data', `Important offline data ${i}`);
      client.map.set(`offline-work-${i}`, itemMap);

      // Simulate some "time passing"
      if (i % 100 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }
    metrics.endTimer('offline-period');

    // Meanwhile, server got updates from other sources
    for (let i = 0; i < 200; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `server-update-${i}`);
      server.map.set(`server-update-${i}`, itemMap);
    }

    // Reconnect and sync
    network.goOnline('client');

    metrics.startTimer('large-sync');
    replicateWithStateVectors(client, server);
    replicateWithStateVectors(server, client);
    const syncTime = metrics.endTimer('large-sync');

    expect(syncTime).toBeLessThan(10000);

    // Both should have all documents
    const expectedTotal = 100 + offlineMutations + 200;
    expect(client.map.size).toBe(expectedTotal);
    expect(server.map.size).toBe(expectedTotal);
  });

  it('handles interleaved online/offline periods', async () => {
    const collection = 'interleaved-test';
    const cycles = 10;
    const opsPerCycle = 50;

    const client = createTestYjsClient(collection);
    const server = createTestYjsClient(collection);
    clients.push(client, server);

    network.registerClient('client', 'online');

    metrics.startTimer('interleaved');

    for (let cycle = 0; cycle < cycles; cycle++) {
      // Online phase - sync with server
      network.goOnline('client');

      // Make some changes
      for (let i = 0; i < opsPerCycle; i++) {
        const itemMap = new Y.Map<unknown>();
        itemMap.set('id', `cycle-${cycle}-online-${i}`);
        client.map.set(`cycle-${cycle}-online-${i}`, itemMap);
      }

      // Sync
      replicateWithStateVectors(client, server);

      // Offline phase
      network.goOffline('client');

      // Make offline changes
      for (let i = 0; i < opsPerCycle; i++) {
        const itemMap = new Y.Map<unknown>();
        itemMap.set('id', `cycle-${cycle}-offline-${i}`);
        client.map.set(`cycle-${cycle}-offline-${i}`, itemMap);
      }

      // Server also makes changes
      for (let i = 0; i < 10; i++) {
        const itemMap = new Y.Map<unknown>();
        itemMap.set('id', `cycle-${cycle}-server-${i}`);
        server.map.set(`cycle-${cycle}-server-${i}`, itemMap);
      }
    }

    // Final sync
    network.goOnline('client');
    replicateWithStateVectors(client, server);
    replicateWithStateVectors(server, client);

    const elapsed = metrics.endTimer('interleaved');
    expect(elapsed).toBeLessThan(15000);

    // Calculate expected total
    // Per cycle: 50 online + 50 offline + 10 server = 110
    const expectedTotal = cycles * (opsPerCycle + opsPerCycle + 10);
    expect(client.map.size).toBe(expectedTotal);
    expect(server.map.size).toBe(expectedTotal);
  });

  it('tracks update queue size during offline period', async () => {
    const collection = 'queue-test';

    const client = createTestYjsClient(collection);
    clients.push(client);

    network.registerClient('client', 'online');
    network.goOffline('client');

    const updateCounts: number[] = [];

    // Make mutations and track update queue
    for (let i = 0; i < 100; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `queued-${i}`);
      client.map.set(`queued-${i}`, itemMap);

      updateCounts.push(client.updates.length);
    }

    // Updates should accumulate while offline
    expect(updateCounts[updateCounts.length - 1]).toBeGreaterThan(0);

    // Each mutation should add to updates
    expect(updateCounts.every((count, i) => i === 0 || count >= updateCounts[i - 1])).toBe(true);
  });
});
