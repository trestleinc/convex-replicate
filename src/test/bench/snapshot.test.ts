/**
 * Snapshot System Benchmarks
 * Tests performance thresholds for snapshot recovery operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import * as Y from 'yjs';
import { clear as idbClear } from 'idb-keyval';
import { Snapshot, SnapshotLive, type SnapshotResponse } from '$/client/services/snapshot.js';
import { Checkpoint, type CheckpointData } from '$/client/services/checkpoint.js';
import { MetricsCollector, THRESHOLDS } from '../utils/metrics.js';

// Create mock checkpoint service for benchmarks
function createMockCheckpoint() {
  const savedCheckpoints: Map<string, CheckpointData> = new Map();

  return Checkpoint.of({
    loadCheckpoint: (collection: string) =>
      Effect.succeed(savedCheckpoints.get(collection) ?? { lastModified: 0 }),
    saveCheckpoint: (collection: string, checkpoint: CheckpointData) =>
      Effect.sync(() => {
        savedCheckpoints.set(collection, checkpoint);
      }),
    clearCheckpoint: (collection: string) =>
      Effect.sync(() => {
        savedCheckpoints.delete(collection);
      }),
  });
}

describe('Snapshot Benchmarks', () => {
  let metrics: MetricsCollector;

  beforeEach(async () => {
    metrics = new MetricsCollector();
    await idbClear();
  });

  afterEach(async () => {
    await idbClear();
  });

  function createTestLayer() {
    const mockCheckpoint = createMockCheckpoint();
    return SnapshotLive.pipe(Layer.provide(Layer.succeed(Checkpoint, mockCheckpoint)));
  }

  /**
   * Create a snapshot with N documents
   */
  function createSnapshot(documentCount: number): SnapshotResponse {
    const ydoc = new Y.Doc();
    const ymap = ydoc.getMap<unknown>('bench-collection');

    for (let i = 0; i < documentCount; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `doc-${i}`);
      itemMap.set('title', `Document ${i}`);
      itemMap.set(
        'content',
        `Content for document ${i} with some additional text to make it realistic`
      );
      itemMap.set('createdAt', Date.now());
      itemMap.set('updatedAt', Date.now());
      ymap.set(`doc-${i}`, itemMap);
    }

    const crdtBytes = Y.encodeStateAsUpdateV2(ydoc);
    ydoc.destroy();

    return {
      crdtBytes,
      checkpoint: { lastModified: Date.now() },
      documentCount,
    };
  }

  it('recovers from snapshot with 100 documents under threshold', async () => {
    const snapshot = createSnapshot(100);

    await Effect.runPromise(
      Effect.gen(function* () {
        const snapshotSvc = yield* Snapshot;

        const ydoc = new Y.Doc();
        const ymap = ydoc.getMap<unknown>('bench-collection');

        // Add some existing data to clear
        const existingMap = new Y.Map<unknown>();
        existingMap.set('id', 'existing');
        ymap.set('existing', existingMap);

        metrics.startTimer('recovery');
        const items = yield* snapshotSvc.recoverFromSnapshot(ydoc, ymap, 'bench-collection', () =>
          Effect.succeed(snapshot)
        );
        const elapsed = metrics.endTimer('recovery');

        expect(items.length).toBe(100);
        expect(elapsed).toBeLessThan(THRESHOLDS.snapshotRecoveryMs);

        ydoc.destroy();
      }).pipe(Effect.provide(createTestLayer()))
    );
  });

  it('recovers from snapshot with 1000 documents under threshold', async () => {
    const snapshot = createSnapshot(1000);

    await Effect.runPromise(
      Effect.gen(function* () {
        const snapshotSvc = yield* Snapshot;

        const ydoc = new Y.Doc();
        const ymap = ydoc.getMap<unknown>('bench-collection');

        metrics.startTimer('recovery');
        const items = yield* snapshotSvc.recoverFromSnapshot(ydoc, ymap, 'bench-collection', () =>
          Effect.succeed(snapshot)
        );
        const elapsed = metrics.endTimer('recovery');

        expect(items.length).toBe(1000);
        expect(elapsed).toBeLessThan(THRESHOLDS.snapshotRecoveryMs * 5); // Scale threshold for larger dataset

        ydoc.destroy();
      }).pipe(Effect.provide(createTestLayer()))
    );
  });

  it('handles repeated snapshot recoveries', async () => {
    const iterations = 10;
    const snapshot = createSnapshot(100);

    await Effect.runPromise(
      Effect.gen(function* () {
        const snapshotSvc = yield* Snapshot;

        metrics.startTimer('total');

        for (let i = 0; i < iterations; i++) {
          const ydoc = new Y.Doc();
          const ymap = ydoc.getMap<unknown>('bench-collection');

          yield* snapshotSvc.recoverFromSnapshot(ydoc, ymap, 'bench-collection', () =>
            Effect.succeed(snapshot)
          );

          ydoc.destroy();
        }

        const totalElapsed = metrics.endTimer('total');
        const avgPerRecovery = totalElapsed / iterations;

        expect(avgPerRecovery).toBeLessThan(THRESHOLDS.snapshotRecoveryMs);
      }).pipe(Effect.provide(createTestLayer()))
    );
  });

  it('clears existing data before applying snapshot', async () => {
    const snapshot = createSnapshot(50);

    await Effect.runPromise(
      Effect.gen(function* () {
        const snapshotSvc = yield* Snapshot;

        const ydoc = new Y.Doc();
        const ymap = ydoc.getMap<unknown>('bench-collection');

        // Add 100 existing documents
        for (let i = 0; i < 100; i++) {
          const itemMap = new Y.Map<unknown>();
          itemMap.set('id', `existing-${i}`);
          ymap.set(`existing-${i}`, itemMap);
        }

        expect(ymap.size).toBe(100);

        metrics.startTimer('recovery-with-clear');
        const items = yield* snapshotSvc.recoverFromSnapshot(ydoc, ymap, 'bench-collection', () =>
          Effect.succeed(snapshot)
        );
        const elapsed = metrics.endTimer('recovery-with-clear');

        // Should have replaced with snapshot data
        expect(items.length).toBe(50);
        expect(ymap.size).toBe(50);
        expect(elapsed).toBeLessThan(THRESHOLDS.snapshotRecoveryMs * 2); // Allow extra time for clear

        ydoc.destroy();
      }).pipe(Effect.provide(createTestLayer()))
    );
  });

  it('snapshot encoding is efficient', async () => {
    const documentCount = 500;

    metrics.startTimer('encoding');

    const ydoc = new Y.Doc();
    const ymap = ydoc.getMap<unknown>('bench-collection');

    for (let i = 0; i < documentCount; i++) {
      const itemMap = new Y.Map<unknown>();
      itemMap.set('id', `doc-${i}`);
      itemMap.set('data', `Data ${i}`);
      ymap.set(`doc-${i}`, itemMap);
    }

    const encoded = Y.encodeStateAsUpdate(ydoc);
    const elapsed = metrics.endTimer('encoding');

    metrics.record('bytes', encoded.byteLength, 'bytes');
    metrics.record('docs', documentCount, 'count');

    // Encoding should be fast
    expect(elapsed).toBeLessThan(100); // 100ms for 500 docs

    // Check reasonable size (roughly ~100 bytes per doc with our data)
    const avgBytesPerDoc = encoded.byteLength / documentCount;
    expect(avgBytesPerDoc).toBeLessThan(200);

    ydoc.destroy();
  });

  it('snapshot decoding is efficient', async () => {
    const snapshot = createSnapshot(500);

    metrics.startTimer('decoding');

    const ydoc = new Y.Doc();
    Y.applyUpdateV2(ydoc, snapshot.crdtBytes);

    const elapsed = metrics.endTimer('decoding');

    const ymap = ydoc.getMap<unknown>('bench-collection');
    expect(ymap.size).toBe(500);
    expect(elapsed).toBeLessThan(100); // 100ms for 500 docs

    ydoc.destroy();
  });
});
