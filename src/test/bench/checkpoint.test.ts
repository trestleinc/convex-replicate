/**
 * Checkpoint System Benchmarks
 * Tests performance thresholds for checkpoint save/load operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { clear as idbClear } from 'idb-keyval';
import { Checkpoint, CheckpointLive } from '$/client/services/checkpoint.js';
import { MetricsCollector, THRESHOLDS } from '../utils/metrics.js';

describe('Checkpoint Benchmarks', () => {
  let metrics: MetricsCollector;

  beforeEach(async () => {
    metrics = new MetricsCollector();
    await idbClear();
  });

  afterEach(async () => {
    await idbClear();
  });

  it('saves checkpoint under threshold', async () => {
    const checkpoint = { lastModified: Date.now() };

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* Checkpoint;

        metrics.startTimer('save');
        yield* checkpointSvc.saveCheckpoint('bench-collection', checkpoint);
        const elapsed = metrics.endTimer('save');

        expect(elapsed).toBeLessThan(THRESHOLDS.checkpointSaveMs);
      }).pipe(Effect.provide(CheckpointLive))
    );
  });

  it('loads checkpoint under threshold', async () => {
    const checkpoint = { lastModified: Date.now() };

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* Checkpoint;

        // Save first
        yield* checkpointSvc.saveCheckpoint('bench-collection', checkpoint);

        // Measure load time
        metrics.startTimer('load');
        const loaded = yield* checkpointSvc.loadCheckpoint('bench-collection');
        const elapsed = metrics.endTimer('load');

        expect(loaded).toEqual(checkpoint);
        expect(elapsed).toBeLessThan(THRESHOLDS.checkpointLoadMs);
      }).pipe(Effect.provide(CheckpointLive))
    );
  });

  it('handles 100 save/load cycles under aggregate threshold', async () => {
    const iterations = 100;

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* Checkpoint;

        metrics.startTimer('total');

        for (let i = 0; i < iterations; i++) {
          const checkpoint = { lastModified: Date.now() + i };
          const collection = `bench-collection-${i}`;

          yield* checkpointSvc.saveCheckpoint(collection, checkpoint);
          yield* checkpointSvc.loadCheckpoint(collection);
        }

        const totalElapsed = metrics.endTimer('total');
        const avgPerCycle = totalElapsed / iterations;

        // Average per cycle should be under combined threshold
        const combinedThreshold = THRESHOLDS.checkpointSaveMs + THRESHOLDS.checkpointLoadMs;
        expect(avgPerCycle).toBeLessThan(combinedThreshold);
      }).pipe(Effect.provide(CheckpointLive))
    );
  });

  it('handles rapid overwrites efficiently', async () => {
    const iterations = 50;

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* Checkpoint;

        metrics.startTimer('overwrites');

        for (let i = 0; i < iterations; i++) {
          const checkpoint = { lastModified: i };
          yield* checkpointSvc.saveCheckpoint('same-collection', checkpoint);
        }

        const elapsed = metrics.endTimer('overwrites');
        const avgPerWrite = elapsed / iterations;

        expect(avgPerWrite).toBeLessThan(THRESHOLDS.checkpointSaveMs);

        // Verify final value
        const final = yield* checkpointSvc.loadCheckpoint('same-collection');
        expect(final.lastModified).toBe(iterations - 1);
      }).pipe(Effect.provide(CheckpointLive))
    );
  });

  it('handles concurrent collection saves', async () => {
    const collectionCount = 20;

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* Checkpoint;

        metrics.startTimer('concurrent');

        // Create checkpoints for many collections in parallel
        const saves = Array.from({ length: collectionCount }, (_, i) =>
          checkpointSvc.saveCheckpoint(`collection-${i}`, { lastModified: i })
        );

        yield* Effect.all(saves, { concurrency: 'unbounded' });

        const elapsed = metrics.endTimer('concurrent');
        const avgPerSave = elapsed / collectionCount;

        expect(avgPerSave).toBeLessThan(THRESHOLDS.checkpointSaveMs * 2); // Allow some overhead for concurrency

        // Verify all saved correctly
        for (let i = 0; i < collectionCount; i++) {
          const loaded = yield* checkpointSvc.loadCheckpoint(`collection-${i}`);
          expect(loaded.lastModified).toBe(i);
        }
      }).pipe(Effect.provide(CheckpointLive))
    );
  });

  it('clear operation is fast', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* Checkpoint;

        // Save a checkpoint first
        yield* checkpointSvc.saveCheckpoint('to-clear', { lastModified: 123 });

        // Measure clear time
        metrics.startTimer('clear');
        yield* checkpointSvc.clearCheckpoint('to-clear');
        const elapsed = metrics.endTimer('clear');

        expect(elapsed).toBeLessThan(THRESHOLDS.checkpointSaveMs);

        // Verify cleared
        const loaded = yield* checkpointSvc.loadCheckpoint('to-clear');
        expect(loaded.lastModified).toBe(0);
      }).pipe(Effect.provide(CheckpointLive))
    );
  });
});
