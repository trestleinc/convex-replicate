/**
 * Reconnection Stress Tests
 * Tests disconnect/reconnect cycles and data integrity
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

describe('Reconnection Stress Tests', () => {
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

  it('survives 100 disconnect/reconnect cycles', async () => {
    const cycles = 100;
    const collection = 'reconnect-cycles';

    const client = createTestYjsClient(collection);
    const server = createTestYjsClient(collection);
    clients.push(client, server);

    network.registerClient('client', 'online');

    metrics.startTimer('cycles');

    for (let cycle = 0; cycle < cycles; cycle++) {
      // Disconnect
      network.goOffline('client');

      // Make mutation while offline
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `cycle-${cycle}`);
      itemMap.set('cycle', cycle);
      client.map.set(`cycle-${cycle}`, itemMap);

      // Reconnect
      network.goOnline('client');

      // Sync
      replicateWithStateVectors(client, server);

      // Verify sync worked
      expect(server.map.size).toBe(cycle + 1);
    }

    const elapsed = metrics.endTimer('cycles');
    expect(elapsed).toBeLessThan(30000); // 30 seconds for 100 cycles

    // Verify all documents present
    expect(client.map.size).toBe(cycles);
    expect(server.map.size).toBe(cycles);

    // Verify data integrity
    for (let i = 0; i < cycles; i++) {
      const serverDoc = server.map.get(`cycle-${i}`) as Y.Map<unknown>;
      expect(serverDoc).toBeDefined();
      expect(serverDoc.get('cycle')).toBe(i);
    }
  });

  it('handles staggered reconnection of 20 clients', async () => {
    const clientCount = 20;
    const collection = 'staggered-reconnect';

    const server = createTestYjsClient(collection);
    clients.push(server);

    // Create clients and register with network
    for (let i = 0; i < clientCount; i++) {
      const client = createTestYjsClient(collection);
      clients.push(client);
      network.registerClient(`client-${i}`, 'online');
    }

    // Initial sync
    for (let i = 1; i <= clientCount; i++) {
      replicateWithStateVectors(server, clients[i]);
    }

    // All clients go offline
    for (let i = 0; i < clientCount; i++) {
      network.goOffline(`client-${i}`);
    }

    // Each client makes mutations while offline
    for (let i = 1; i <= clientCount; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `client-${i - 1}-offline`);
      clients[i].map.set(`client-${i - 1}-offline`, itemMap);
    }

    metrics.startTimer('staggered');

    // Staggered reconnection with 10ms delay between each
    await network.staggeredReconnect(
      Array.from({ length: clientCount }, (_, i) => `client-${i}`),
      10
    );

    // Sync each client as it reconnects
    for (let i = 1; i <= clientCount; i++) {
      if (network.isOnline(`client-${i - 1}`)) {
        replicateWithStateVectors(clients[i], server);
      }
    }

    // Final sync to propagate all changes
    for (let i = 1; i <= clientCount; i++) {
      replicateWithStateVectors(server, clients[i]);
    }

    const elapsed = metrics.endTimer('staggered');
    expect(elapsed).toBeLessThan(5000);

    // All should have same state
    expect(server.map.size).toBe(clientCount);
    for (let i = 1; i <= clientCount; i++) {
      expect(clients[i].map.size).toBe(clientCount);
    }
  });

  it('handles rapid reconnection attempts', async () => {
    const collection = 'rapid-reconnect';
    const rapidCycles = 50;

    const client = createTestYjsClient(collection);
    const server = createTestYjsClient(collection);
    clients.push(client, server);

    network.registerClient('client', 'online');

    // Seed some data
    for (let i = 0; i < 100; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `seed-${i}`);
      server.map.set(`seed-${i}`, itemMap);
    }
    replicateWithStateVectors(server, client);

    metrics.startTimer('rapid');

    // Rapid disconnect/reconnect with no time between
    for (let i = 0; i < rapidCycles; i++) {
      network.goOffline('client');
      network.goOnline('client');

      // Quick sync
      replicateWithStateVectors(client, server);
    }

    const elapsed = metrics.endTimer('rapid');
    expect(elapsed).toBeLessThan(5000);

    // State should remain consistent
    expect(client.map.size).toBe(100);
    expect(server.map.size).toBe(100);
  });

  it('handles connection state callbacks', async () => {
    const collection = 'callback-test';
    const stateChanges: Array<{ clientId: string; state: string }> = [];

    const client = createTestYjsClient(collection);
    clients.push(client);

    network.registerClient('client', 'online');

    // Subscribe to state changes
    const unsubscribe = network.onStateChange('client', (state) => {
      stateChanges.push({ clientId: 'client', state });
    });

    // Toggle connection multiple times
    for (let i = 0; i < 10; i++) {
      network.goOffline('client');
      network.goOnline('client');
    }

    // Should have recorded all state changes
    expect(stateChanges.length).toBe(20); // 10 offline + 10 online

    // Verify alternating pattern
    for (let i = 0; i < stateChanges.length; i++) {
      const expected = i % 2 === 0 ? 'offline' : 'online';
      expect(stateChanges[i].state).toBe(expected);
    }

    unsubscribe();
  });

  it('maintains data integrity across network flakiness', async () => {
    const collection = 'flaky-network';
    const duration = 1000; // 1 second of flaky network

    const client = createTestYjsClient(collection);
    const server = createTestYjsClient(collection);
    clients.push(client, server);

    network.registerClient('client', 'online');

    // Add initial data
    for (let i = 0; i < 50; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `initial-${i}`);
      itemMap.set('value', i);
      client.map.set(`initial-${i}`, itemMap);
    }
    replicateWithStateVectors(client, server);

    metrics.startTimer('flaky');

    // Simulate flaky network while making changes
    const flakyPromise = network.simulateFlakyNetwork(['client'], duration, {
      disconnectProbability: 0.2,
      reconnectProbability: 0.5,
      checkIntervalMs: 50,
    });

    // Make changes during flaky period
    let changesMade = 0;
    const startTime = Date.now();
    while (Date.now() - startTime < duration) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `flaky-${changesMade}`);
      client.map.set(`flaky-${changesMade}`, itemMap);
      changesMade++;

      // Only sync when online
      if (network.isOnline('client')) {
        replicateWithStateVectors(client, server);
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await flakyPromise;

    // Final sync after flaky period ends (all clients online)
    replicateWithStateVectors(client, server);

    const _elapsed = metrics.endTimer('flaky');

    // Both should have all data after final sync
    expect(server.map.size).toBe(50 + changesMade);
    expect(client.map.size).toBe(50 + changesMade);
  });

  it('handles simultaneous reconnection of all clients', async () => {
    const clientCount = 15;
    const collection = 'simultaneous-reconnect';

    const server = createTestYjsClient(collection);
    clients.push(server);

    // Create clients
    for (let i = 0; i < clientCount; i++) {
      const client = createTestYjsClient(collection);
      clients.push(client);
      network.registerClient(`client-${i}`, 'online');
    }

    // All go offline
    for (let i = 0; i < clientCount; i++) {
      network.goOffline(`client-${i}`);
    }

    // Each makes changes
    for (let i = 1; i <= clientCount; i++) {
      for (let j = 0; j < 10; j++) {
        const itemMap = new Y.Map<unknown>();
        itemMap.set('id', `client-${i - 1}-doc-${j}`);
        clients[i].map.set(`client-${i - 1}-doc-${j}`, itemMap);
      }
    }

    metrics.startTimer('simultaneous');

    // All reconnect at once
    for (let i = 0; i < clientCount; i++) {
      network.goOnline(`client-${i}`);
    }

    // Parallel sync (simulated)
    const syncPromises = [];
    for (let i = 1; i <= clientCount; i++) {
      syncPromises.push(
        Promise.resolve().then(() => {
          replicateWithStateVectors(clients[i], server);
        })
      );
    }
    await Promise.all(syncPromises);

    // Propagate to all clients
    for (let i = 1; i <= clientCount; i++) {
      replicateWithStateVectors(server, clients[i]);
    }

    const elapsed = metrics.endTimer('simultaneous');
    expect(elapsed).toBeLessThan(5000);

    // All should have same state
    const expectedDocs = clientCount * 10;
    expect(server.map.size).toBe(expectedDocs);
    for (let i = 1; i <= clientCount; i++) {
      expect(clients[i].map.size).toBe(expectedDocs);
    }
  });

  it('tracks event log during reconnection', async () => {
    const collection = 'event-log-test';

    const client = createTestYjsClient(collection);
    clients.push(client);

    network.registerClient('client', 'online');

    // Clear any initial events
    network.clearEventLog();

    // Generate events
    network.goOffline('client');
    network.goOnline('client');
    network.goOffline('client');
    network.goOnline('client');

    const events = network.getEventLog();

    expect(events.length).toBe(4);

    // Verify event structure
    expect(events[0].clientId).toBe('client');
    expect(events[0].previousState).toBe('online');
    expect(events[0].newState).toBe('offline');

    expect(events[1].previousState).toBe('offline');
    expect(events[1].newState).toBe('online');

    // Verify timestamps are ordered
    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
    }
  });
});
