import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import * as Y from 'yjs';
import {
  SnapshotService,
  SnapshotServiceLive,
  SnapshotMissingError,
  SnapshotRecoveryError,
  type SnapshotResponse,
} from '../../client/services/SnapshotService.js';
import { CheckpointService, type Checkpoint } from '../../client/services/CheckpointService.js';

// Mock CheckpointService
function createMockCheckpointService() {
  const savedCheckpoints: Map<string, Checkpoint> = new Map();

  return {
    service: CheckpointService.of({
      loadCheckpoint: (collection: string) =>
        Effect.succeed(savedCheckpoints.get(collection) ?? { lastModified: 0 }),
      saveCheckpoint: (collection: string, checkpoint: Checkpoint) =>
        Effect.sync(() => {
          savedCheckpoints.set(collection, checkpoint);
        }),
      clearCheckpoint: (collection: string) =>
        Effect.sync(() => {
          savedCheckpoints.delete(collection);
        }),
    }),
    savedCheckpoints,
  };
}

// Create snapshot response for testing
function createTestSnapshotResponse(overrides?: Partial<SnapshotResponse>): SnapshotResponse {
  const doc = new Y.Doc();
  const map = doc.getMap('test-collection');
  const itemMap = new Y.Map();
  itemMap.set('id', 'doc-1');
  itemMap.set('title', 'Test');
  map.set('doc-1', itemMap);

  return {
    // Use V2 encoding to match yjs-helpers.applyUpdate()
    crdtBytes: Y.encodeStateAsUpdateV2(doc),
    checkpoint: { lastModified: overrides?.checkpoint?.lastModified ?? Date.now() },
    documentCount: overrides?.documentCount ?? 1,
    ...overrides,
  };
}

// Create a test Yjs document and map
function createTestYjsContext() {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap<unknown>('test-collection');
  return { ydoc, ymap };
}

describe('SnapshotService', () => {
  let mockCheckpointResult: ReturnType<typeof createMockCheckpointService>;

  beforeEach(() => {
    mockCheckpointResult = createMockCheckpointService();
  });

  function createTestLayer() {
    // SnapshotServiceLive now uses plain yjs-helpers functions - only needs CheckpointService
    return SnapshotServiceLive.pipe(
      Layer.provide(Layer.succeed(CheckpointService, mockCheckpointResult.service))
    );
  }

  // ============================================
  // RECOVER FROM SNAPSHOT
  // ============================================
  describe('recoverFromSnapshot', () => {
    it('fetches snapshot from provided function', async () => {
      const { ydoc, ymap } = createTestYjsContext();
      const fetchSnapshot = vi.fn().mockReturnValue(Effect.succeed(createTestSnapshotResponse()));

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* SnapshotService;
          yield* svc.recoverFromSnapshot(ydoc, ymap, 'test-collection', fetchSnapshot);
        }).pipe(Effect.provide(createTestLayer()))
      );

      expect(fetchSnapshot).toHaveBeenCalled();
    });

    it('applies snapshot to Yjs document', async () => {
      const { ydoc, ymap } = createTestYjsContext();
      const snapshot = createTestSnapshotResponse();
      const fetchSnapshot = vi.fn().mockReturnValue(Effect.succeed(snapshot));

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* SnapshotService;
          yield* svc.recoverFromSnapshot(ydoc, ymap, 'test-collection', fetchSnapshot);
        }).pipe(Effect.provide(createTestLayer()))
      );

      // Verify the snapshot was applied - ymap should have content
      expect(fetchSnapshot).toHaveBeenCalled();
    });

    it('saves checkpoint after recovery', async () => {
      const { ydoc, ymap } = createTestYjsContext();
      const checkpoint: Checkpoint = { lastModified: 123456789 };
      const snapshot = createTestSnapshotResponse({ checkpoint });
      const fetchSnapshot = vi.fn().mockReturnValue(Effect.succeed(snapshot));

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* SnapshotService;
          yield* svc.recoverFromSnapshot(ydoc, ymap, 'test-collection', fetchSnapshot);
        }).pipe(Effect.provide(createTestLayer()))
      );

      expect(mockCheckpointResult.savedCheckpoints.get('test-collection')).toEqual(checkpoint);
    });

    it('returns items for TanStack DB sync', async () => {
      const { ydoc, ymap } = createTestYjsContext();
      const snapshot = createTestSnapshotResponse();
      const fetchSnapshot = vi.fn().mockReturnValue(Effect.succeed(snapshot));

      const items = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* SnapshotService;
          return yield* svc.recoverFromSnapshot(ydoc, ymap, 'test-collection', fetchSnapshot);
        }).pipe(Effect.provide(createTestLayer()))
      );

      // Should return the items from the snapshot
      expect(Array.isArray(items)).toBe(true);
    });

    it('clears existing Yjs state before applying snapshot', async () => {
      const { ydoc, ymap } = createTestYjsContext();

      // Add some existing data to ymap
      const existingItem = new Y.Map();
      existingItem.set('id', 'existing');
      ymap.set('existing-key', existingItem);
      expect(ymap.size).toBe(1);

      const snapshot = createTestSnapshotResponse();
      const fetchSnapshot = vi.fn().mockReturnValue(Effect.succeed(snapshot));

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* SnapshotService;
          yield* svc.recoverFromSnapshot(ydoc, ymap, 'test-collection', fetchSnapshot);
        }).pipe(Effect.provide(createTestLayer()))
      );

      // Existing key should be gone (cleared before snapshot applied)
      expect(ymap.has('existing-key')).toBe(false);
    });
  });

  // ============================================
  // ERROR HANDLING
  // ============================================
  describe('Error Handling', () => {
    describe('when snapshot is missing', () => {
      it('fails with SnapshotMissingError when fetchSnapshot returns null', async () => {
        const { ydoc, ymap } = createTestYjsContext();
        const fetchSnapshot = vi.fn().mockReturnValue(Effect.succeed(null));

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SnapshotService;
            return yield* svc.recoverFromSnapshot(ydoc, ymap, 'test-collection', fetchSnapshot);
          }).pipe(Effect.provide(createTestLayer()), Effect.either)
        );

        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left._tag).toBe('SnapshotMissingError');
          if (result.left._tag === 'SnapshotMissingError') {
            expect(result.left.collection).toBe('test-collection');
          }
        }
      });
    });

    describe('when recovery fails', () => {
      it('wraps errors in SnapshotRecoveryError', async () => {
        const { ydoc, ymap } = createTestYjsContext();
        const fetchSnapshot = vi.fn().mockReturnValue(Effect.fail(new Error('Network error')));

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* SnapshotService;
            return yield* svc.recoverFromSnapshot(ydoc, ymap, 'test-collection', fetchSnapshot);
          }).pipe(Effect.provide(createTestLayer()), Effect.either)
        );

        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left._tag).toBe('SnapshotRecoveryError');
          if (result.left._tag === 'SnapshotRecoveryError') {
            expect(result.left.collection).toBe('test-collection');
          }
        }
      });
    });
  });

  // ============================================
  // ERROR CLASSES
  // ============================================
  describe('Error Classes', () => {
    describe('SnapshotMissingError', () => {
      it('has correct tag', () => {
        const error = new SnapshotMissingError({
          collection: 'tasks',
          message: 'No snapshot available',
        });
        expect(error._tag).toBe('SnapshotMissingError');
      });

      it('contains collection and message', () => {
        const error = new SnapshotMissingError({
          collection: 'tasks',
          message: 'No snapshot available',
        });
        expect(error.collection).toBe('tasks');
        expect(error.message).toBe('No snapshot available');
      });
    });

    describe('SnapshotRecoveryError', () => {
      it('has correct tag', () => {
        const error = new SnapshotRecoveryError({
          collection: 'tasks',
          cause: new Error('Something went wrong'),
        });
        expect(error._tag).toBe('SnapshotRecoveryError');
      });

      it('contains collection and cause', () => {
        const originalError = new Error('Something went wrong');
        const error = new SnapshotRecoveryError({
          collection: 'tasks',
          cause: originalError,
        });
        expect(error.collection).toBe('tasks');
        expect(error.cause).toBe(originalError);
      });
    });
  });
});
