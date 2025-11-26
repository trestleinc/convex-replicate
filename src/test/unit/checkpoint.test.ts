import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { Checkpoint, CheckpointLive } from '$/client/services/checkpoint.js';

describe('Checkpoint', () => {
  // CheckpointLive now uses idb-keyval directly - no IDBService dependency
  const testLayer = CheckpointLive;

  it('saves checkpoint to IndexedDB', async () => {
    const checkpoint = { lastModified: Date.now() };

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* Checkpoint;

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
        const checkpointSvc = yield* Checkpoint;

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
        const checkpointSvc = yield* Checkpoint;

        // Try to load from non-existent collection
        const loaded = yield* checkpointSvc.loadCheckpoint('non-existent-collection');

        expect(loaded.lastModified).toBe(0);
      }).pipe(Effect.provide(testLayer))
    );
  });

  it('overwrites existing checkpoint', async () => {
    const checkpoint1 = { lastModified: 100 };
    const checkpoint2 = { lastModified: 200 };

    await Effect.runPromise(
      Effect.gen(function* () {
        const checkpointSvc = yield* Checkpoint;

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
        const checkpointSvc = yield* Checkpoint;

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
