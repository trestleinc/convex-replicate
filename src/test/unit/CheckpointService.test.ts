import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import {
  CheckpointService,
  CheckpointServiceLive,
  IDBServiceLive,
} from '../../client/services/index.js';

describe('CheckpointService', () => {
  const testLayer = Layer.provide(CheckpointServiceLive, IDBServiceLive);

  it('saves checkpoint to IndexedDB', async () => {
    const checkpoint = { lastModified: Date.now() };

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* CheckpointService;

        yield* checkpointSvc.saveCheckpoint('test-collection', checkpoint);

        // Verify by loading it back
        const loaded = yield* checkpointSvc.loadCheckpoint('test-collection');

        expect(loaded).toEqual(checkpoint);
      }).pipe(Effect.provide(testLayer))
    );
  });

  it('loads stored checkpoint', async () => {
    const checkpoint = { lastModified: 1234567890 };

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* CheckpointService;

        // Save checkpoint
        yield* checkpointSvc.saveCheckpoint('test-collection', checkpoint);

        // Load it
        const loaded = yield* checkpointSvc.loadCheckpoint('test-collection');

        expect(loaded.lastModified).toBe(1234567890);
      }).pipe(Effect.provide(testLayer))
    );
  });

  it('returns default checkpoint when none exists', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* CheckpointService;

        // Try to load from non-existent collection
        const loaded = yield* checkpointSvc.loadCheckpoint('non-existent-collection');

        expect(loaded.lastModified).toBe(0);
      }).pipe(Effect.provide(testLayer))
    );
  });

  it('loadCheckpointWithStaleDetection returns 0 when SSR data present', async () => {
    const checkpoint = { lastModified: Date.now() };

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* CheckpointService;

        // Save a checkpoint
        yield* checkpointSvc.saveCheckpoint('test-collection', checkpoint);

        // Load with SSR data present (hasSSRData = true)
        const loaded = yield* checkpointSvc.loadCheckpointWithStaleDetection(
          'test-collection',
          true
        );

        // Should return 0 checkpoint
        expect(loaded.lastModified).toBe(0);
      }).pipe(Effect.provide(testLayer))
    );
  });

  it('loadCheckpointWithStaleDetection returns stored checkpoint when fresh', async () => {
    const checkpoint = { lastModified: Date.now() };

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* CheckpointService;

        // Save a fresh checkpoint
        yield* checkpointSvc.saveCheckpoint('test-collection', checkpoint);

        // Load without SSR data (hasSSRData = false)
        const loaded = yield* checkpointSvc.loadCheckpointWithStaleDetection(
          'test-collection',
          false
        );

        // Should return stored checkpoint
        expect(loaded.lastModified).toBe(checkpoint.lastModified);
      }).pipe(Effect.provide(testLayer))
    );
  });

  it('loadCheckpointWithStaleDetection returns stored checkpoint even if old', async () => {
    // Create old checkpoint (note: current implementation doesn't check staleness)
    const oldTime = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const oldCheckpoint = { lastModified: oldTime };

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* CheckpointService;

        // Save old checkpoint
        yield* checkpointSvc.saveCheckpoint('test-collection', oldCheckpoint);

        // Load without SSR data
        const loaded = yield* checkpointSvc.loadCheckpointWithStaleDetection(
          'test-collection',
          false
        );

        // Current implementation returns stored checkpoint (no staleness check)
        expect(loaded.lastModified).toBe(oldTime);
      }).pipe(Effect.provide(testLayer))
    );
  });

  it('overwrites existing checkpoint', async () => {
    const checkpoint1 = { lastModified: 100 };
    const checkpoint2 = { lastModified: 200 };

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* CheckpointService;

        // Save first checkpoint
        yield* checkpointSvc.saveCheckpoint('test-collection', checkpoint1);

        // Overwrite with second
        yield* checkpointSvc.saveCheckpoint('test-collection', checkpoint2);

        // Load should return second
        const loaded = yield* checkpointSvc.loadCheckpoint('test-collection');

        expect(loaded.lastModified).toBe(200);
      }).pipe(Effect.provide(testLayer))
    );
  });

  it('handles multiple collections independently', async () => {
    const checkpoint1 = { lastModified: 100 };
    const checkpoint2 = { lastModified: 200 };

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* CheckpointService;

        // Save to different collections
        yield* checkpointSvc.saveCheckpoint('collection-1', checkpoint1);
        yield* checkpointSvc.saveCheckpoint('collection-2', checkpoint2);

        // Load both
        const loaded1 = yield* checkpointSvc.loadCheckpoint('collection-1');
        const loaded2 = yield* checkpointSvc.loadCheckpoint('collection-2');

        expect(loaded1.lastModified).toBe(100);
        expect(loaded2.lastModified).toBe(200);
      }).pipe(Effect.provide(testLayer))
    );
  });
});
