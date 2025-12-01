/**
 * Delta Throughput Benchmarks
 * Tests performance of Yjs delta encoding, decoding, and merging operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { MetricsCollector, THRESHOLDS } from '../utils/metrics.js';
import { createTestYjsClient, replicateWithStateVectors } from '../utils/yjs.js';

describe('Delta Throughput Benchmarks', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  it('applies 1000 deltas above throughput threshold', async () => {
    const operationCount = 1000;
    const ydoc = new Y.Doc();
    const ymap = ydoc.getMap<Y.Map<unknown>>('bench-collection');

    // Generate deltas
    const deltas: Uint8Array[] = [];
    for (let i = 0; i < operationCount; i++) {
      const beforeVector = Y.encodeStateVector(ydoc);
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `doc-${i}`);
      itemMap.set('value', i);
      ymap.set(`doc-${i}`, itemMap);
      deltas.push(Y.encodeStateAsUpdate(ydoc, beforeVector));
    }

    // Apply deltas to a fresh document
    const targetDoc = new Y.Doc();

    metrics.startTimer('apply');
    for (const delta of deltas) {
      Y.applyUpdate(targetDoc, delta);
    }
    const elapsed = metrics.endTimer('apply');

    const opsPerSec = metrics.calculateThroughput(operationCount, elapsed);

    expect(opsPerSec).toBeGreaterThan(THRESHOLDS.throughputOpsPerSec);

    // Verify all applied
    const targetMap = targetDoc.getMap<Y.Map<unknown>>('bench-collection');
    expect(targetMap.size).toBe(operationCount);

    ydoc.destroy();
    targetDoc.destroy();
  });

  it('applies deltas efficiently with state vectors', async () => {
    const clientA = createTestYjsClient('bench-collection');
    const clientB = createTestYjsClient('bench-collection');

    // Client A makes 500 changes
    for (let i = 0; i < 500; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `a-${i}`);
      clientA.map.set(`a-${i}`, itemMap);
    }

    // Client B makes 500 changes
    for (let i = 0; i < 500; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `b-${i}`);
      clientB.map.set(`b-${i}`, itemMap);
    }

    metrics.startTimer('replicate');
    replicateWithStateVectors(clientA, clientB);
    const elapsed = metrics.endTimer('replicate');

    // Should be fast - state vector sync is efficient
    expect(elapsed).toBeLessThan(100); // 100ms for syncing 1000 total docs

    // Both should have all documents
    expect(clientA.map.size).toBe(1000);
    expect(clientB.map.size).toBe(1000);

    clientA.cleanup();
    clientB.cleanup();
  });

  it('handles concurrent delta generation from multiple sources', async () => {
    const clientCount = 10;
    const opsPerClient = 100;
    const clients = Array.from({ length: clientCount }, (_, i) =>
      createTestYjsClient(`client-${i}`)
    );

    metrics.startTimer('concurrent-gen');

    // Each client generates deltas
    for (let i = 0; i < opsPerClient; i++) {
      for (let c = 0; c < clientCount; c++) {
        const client = clients[c];
        const itemMap = new Y.Map<unknown>();
        itemMap.set('id', `client-${c}-op-${i}`);
        itemMap.set('client', c);
        itemMap.set('op', i);
        client.map.set(`client-${c}-op-${i}`, itemMap);
      }
    }

    const elapsed = metrics.endTimer('concurrent-gen');
    const totalOps = clientCount * opsPerClient;
    const opsPerSec = metrics.calculateThroughput(totalOps, elapsed);

    expect(opsPerSec).toBeGreaterThan(THRESHOLDS.throughputOpsPerSec);

    // Cleanup
    for (const client of clients) {
      client.cleanup();
    }
  });

  it('delta encoding is efficient', async () => {
    const ydoc = new Y.Doc();
    const ymap = ydoc.getMap<Y.Map<unknown>>('bench-collection');

    const iterations = 100;
    const byteSizes: number[] = [];

    metrics.startTimer('encoding');

    for (let i = 0; i < iterations; i++) {
      const beforeVector = Y.encodeStateVector(ydoc);
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `doc-${i}`);
      itemMap.set('data', `Some data for document ${i}`);
      ymap.set(`doc-${i}`, itemMap);

      const delta = Y.encodeStateAsUpdate(ydoc, beforeVector);
      byteSizes.push(delta.byteLength);
    }

    const elapsed = metrics.endTimer('encoding');
    const avgBytesPerDelta = byteSizes.reduce((a, b) => a + b, 0) / byteSizes.length;

    // Encoding should be fast
    const opsPerSec = metrics.calculateThroughput(iterations, elapsed);
    expect(opsPerSec).toBeGreaterThan(THRESHOLDS.throughputOpsPerSec);

    // Deltas should be reasonably sized (not bloated)
    expect(avgBytesPerDelta).toBeLessThan(200); // Reasonable for small docs

    ydoc.destroy();
  });

  it('merging multiple updates is efficient', async () => {
    const updateCount = 100;
    const ydoc = new Y.Doc();
    const ymap = ydoc.getMap<Y.Map<unknown>>('bench-collection');

    // Generate updates
    const updates: Uint8Array[] = [];
    for (let i = 0; i < updateCount; i++) {
      const beforeVector = Y.encodeStateVector(ydoc);
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `doc-${i}`);
      ymap.set(`doc-${i}`, itemMap);
      updates.push(Y.encodeStateAsUpdate(ydoc, beforeVector));
    }

    metrics.startTimer('merge');
    const merged = Y.mergeUpdates(updates);
    const elapsed = metrics.endTimer('merge');

    // Merging should be fast
    expect(elapsed).toBeLessThan(50); // 50ms for 100 updates

    // Merged update should work
    const verifyDoc = new Y.Doc();
    Y.applyUpdate(verifyDoc, merged);
    const verifyMap = verifyDoc.getMap<Y.Map<unknown>>('bench-collection');
    expect(verifyMap.size).toBe(updateCount);

    ydoc.destroy();
    verifyDoc.destroy();
  });

  it('handles large documents efficiently', async () => {
    const ydoc = new Y.Doc();
    const ymap = ydoc.getMap<Y.Map<unknown>>('bench-collection');

    // Create a document with large content
    const largeContent = 'x'.repeat(10000); // 10KB of data

    metrics.startTimer('large-doc');

    const itemMap = new Y.Map<unknown>();
    itemMap.set('id', 'large-doc');
    itemMap.set('content', largeContent);
    ymap.set('large-doc', itemMap);

    const beforeVector = Y.encodeStateVector(ydoc);

    // Update the large document
    const existingMap = ymap.get('large-doc') as Y.Map<unknown>;
    existingMap.set('content', `${largeContent} updated`);

    const delta = Y.encodeStateAsUpdate(ydoc, beforeVector);
    const elapsed = metrics.endTimer('large-doc');

    expect(elapsed).toBeLessThan(50); // Should still be fast
    expect(delta.byteLength).toBeLessThan(15000); // Reasonable size for 10KB update

    ydoc.destroy();
  });

  it('state vector comparison is fast', async () => {
    const ydoc = new Y.Doc();
    const ymap = ydoc.getMap<Y.Map<unknown>>('bench-collection');

    // Build up some history
    for (let i = 0; i < 500; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `doc-${i}`);
      ymap.set(`doc-${i}`, itemMap);
    }

    const iterations = 1000;

    metrics.startTimer('state-vector');

    for (let i = 0; i < iterations; i++) {
      Y.encodeStateVector(ydoc);
    }

    const elapsed = metrics.endTimer('state-vector');
    const opsPerSec = metrics.calculateThroughput(iterations, elapsed);

    // State vector encoding should be very fast
    expect(opsPerSec).toBeGreaterThan(10000); // >10k ops/sec

    ydoc.destroy();
  });
});
