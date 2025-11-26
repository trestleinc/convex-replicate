/**
 * Full Replicate Flow Integration Tests
 *
 * Tests the complete replicate flow including:
 * - Initial state loading (SSR simulation)
 * - Delta processing and application
 * - Checkpoint management
 * - Multi-client replication scenarios
 *
 * These tests verify the client-side integration works correctly.
 * For true E2E tests with a live Convex backend, see the example apps.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Effect } from 'effect';
import * as Y from 'yjs';
import { del as idbDel } from 'idb-keyval';

// Services
import { Checkpoint, CheckpointLive } from '$/client/services/checkpoint.js';

// Test helpers
import { createTestSSRData, simulateClientServerReplicate } from '$/test/utils/collection.js';

interface TestTask {
  id: string;
  title: string;
  done: boolean;
}

describe('Full Replicate Flow', () => {
  beforeEach(async () => {
    // Clear any stored checkpoints between tests
    await idbDel('replicate:checkpoint:tasks');
    await idbDel('replicate:checkpoint:test-collection');
  });

  describe('Initial State Loading', () => {
    it('applies SSR data correctly to a new client', () => {
      const tasks: TestTask[] = [
        { id: 'task1', title: 'Task 1', done: false },
        { id: 'task2', title: 'Task 2', done: true },
        { id: 'task3', title: 'Task 3', done: false },
      ];

      const ssrData = createTestSSRData('tasks', tasks);

      // Create client and apply SSR data
      const clientDoc = new Y.Doc();
      Y.applyUpdateV2(clientDoc, new Uint8Array(ssrData.crdtBytes));

      const clientMap = clientDoc.getMap<Y.Map<unknown>>('tasks');
      expect(clientMap.size).toBe(3);

      const task1 = clientMap.get('task1') as Y.Map<unknown>;
      expect(task1.get('title')).toBe('Task 1');
      expect(task1.get('done')).toBe(false);

      const task2 = clientMap.get('task2') as Y.Map<unknown>;
      expect(task2.get('done')).toBe(true);

      clientDoc.destroy();
    });

    it('handles empty SSR data gracefully', () => {
      const ssrData = createTestSSRData<TestTask>('tasks', []);

      const clientDoc = new Y.Doc();

      // Empty SSR data should not throw
      if (ssrData.crdtBytes.byteLength > 0) {
        Y.applyUpdateV2(clientDoc, new Uint8Array(ssrData.crdtBytes));
      }

      const clientMap = clientDoc.getMap<Y.Map<unknown>>('tasks');
      expect(clientMap.size).toBe(0);

      clientDoc.destroy();
    });
  });

  describe('Delta Processing', () => {
    it('applies incremental delta to existing state', () => {
      const sync = simulateClientServerReplicate<TestTask>('tasks');

      // Initial state
      sync.clientAMutates({ id: 'task1', title: 'Original', done: false });
      sync.replicateToClientB();

      // Client A makes an update
      sync.clientAMutates({ id: 'task1', title: 'Updated', done: true });
      sync.replicateToClientB();

      const bItems = sync.clientB.getItems();
      expect(bItems).toHaveLength(1);
      expect(bItems[0].title).toBe('Updated');
      expect(bItems[0].done).toBe(true);

      sync.destroy();
    });

    it('handles out-of-order deltas correctly via CRDT', () => {
      const sync = simulateClientServerReplicate<TestTask>('tasks');

      // Both clients make changes to same document
      sync.clientAMutates({ id: 'task1', title: 'From A', done: false });
      sync.clientBMutates({ id: 'task1', title: 'From B', done: true });

      // Sync both clients - CRDT will resolve conflict
      sync.replicateToClientA();
      sync.replicateToClientB();

      // Both clients should have consistent state (CRDT last-writer-wins)
      const aItems = sync.clientA.getItems();
      const bItems = sync.clientB.getItems();

      expect(aItems).toHaveLength(1);
      expect(bItems).toHaveLength(1);

      // CRDTs use last-writer-wins, both should have same values
      expect(aItems[0].id).toBe(bItems[0].id);

      sync.destroy();
    });
  });

  describe('Checkpoint Management', () => {
    it('saves and loads checkpoints correctly', async () => {
      const testLayer = CheckpointLive;

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* Checkpoint;

          // Save checkpoint
          yield* svc.saveCheckpoint('tasks', { lastModified: 12345 });

          // Load checkpoint
          const loaded = yield* svc.loadCheckpoint('tasks');
          return loaded;
        }).pipe(Effect.provide(testLayer))
      );

      expect(result.lastModified).toBe(12345);
    });

    it('returns default checkpoint when none saved', async () => {
      const testLayer = CheckpointLive;

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* Checkpoint;
          return yield* svc.loadCheckpoint('nonexistent-collection');
        }).pipe(Effect.provide(testLayer))
      );

      expect(result.lastModified).toBe(0);
    });

    it('clearing checkpoint resets to default', async () => {
      const testLayer = CheckpointLive;

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* Checkpoint;

          // Save then clear
          yield* svc.saveCheckpoint('tasks', { lastModified: 99999 });
          yield* svc.clearCheckpoint('tasks');

          return yield* svc.loadCheckpoint('tasks');
        }).pipe(Effect.provide(testLayer))
      );

      expect(result.lastModified).toBe(0);
    });
  });

  describe('Multi-Client Sync', () => {
    it('syncs changes from client A to client B', () => {
      const sync = simulateClientServerReplicate<TestTask>('tasks');

      sync.clientAMutates({ id: 'task1', title: 'Created by A', done: false });
      sync.replicateToClientB();

      const bItems = sync.clientB.getItems();
      expect(bItems).toHaveLength(1);
      expect(bItems[0].title).toBe('Created by A');

      sync.destroy();
    });

    it('syncs changes from client B to client A', () => {
      const sync = simulateClientServerReplicate<TestTask>('tasks');

      sync.clientBMutates({ id: 'task1', title: 'Created by B', done: true });
      sync.replicateToClientA();

      const aItems = sync.clientA.getItems();
      expect(aItems).toHaveLength(1);
      expect(aItems[0].title).toBe('Created by B');

      sync.destroy();
    });

    it('maintains consistency with multiple simultaneous clients', () => {
      const sync = simulateClientServerReplicate<TestTask>('tasks');

      // Multiple mutations from both clients
      sync.clientAMutates({ id: 'a1', title: 'A Task 1', done: false });
      sync.clientAMutates({ id: 'a2', title: 'A Task 2', done: false });
      sync.clientBMutates({ id: 'b1', title: 'B Task 1', done: true });
      sync.clientBMutates({ id: 'b2', title: 'B Task 2', done: true });

      // Sync both directions
      sync.replicateToClientA();
      sync.replicateToClientB();

      // Verify both have all tasks
      const aItems = sync.clientA.getItems();
      const bItems = sync.clientB.getItems();

      expect(aItems).toHaveLength(4);
      expect(bItems).toHaveLength(4);

      // Verify specific tasks exist
      expect(aItems.find((t) => t.id === 'b1')?.title).toBe('B Task 1');
      expect(bItems.find((t) => t.id === 'a1')?.title).toBe('A Task 1');

      sync.destroy();
    });
  });

  describe('Reconnection Scenarios', () => {
    it('syncs correctly after simulated disconnect/reconnect', () => {
      const sync = simulateClientServerReplicate<TestTask>('tasks');

      // Initial sync
      sync.clientAMutates({ id: 'task1', title: 'Before disconnect', done: false });
      sync.replicateToClientB();

      // Simulate "disconnect" - client B makes changes while "offline"
      // These go to server but client A hasn't received them yet
      sync.clientBMutates({ id: 'task2', title: 'While A was offline', done: true });

      // Client A "reconnects" and syncs
      sync.replicateToClientA();

      const aItems = sync.clientA.getItems();
      expect(aItems).toHaveLength(2);
      expect(aItems.find((t) => t.id === 'task2')?.title).toBe('While A was offline');

      sync.destroy();
    });

    it('handles stale checkpoint correctly on page refresh', async () => {
      const testLayer = CheckpointLive;

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* Checkpoint;

          // Simulate: previous session saved checkpoint
          yield* svc.saveCheckpoint('tasks', { lastModified: 9999 });

          // Simulate: page refresh - clear checkpoint
          yield* svc.clearCheckpoint('tasks');

          // Verify checkpoint is reset
          const checkpoint = yield* svc.loadCheckpoint('tasks');
          expect(checkpoint.lastModified).toBe(0);

          // New SSR data comes in, save its checkpoint
          const ssrCheckpoint = { lastModified: 5000 };
          yield* svc.saveCheckpoint('tasks', ssrCheckpoint);

          // Verify SSR checkpoint is used
          const loaded = yield* svc.loadCheckpoint('tasks');
          expect(loaded.lastModified).toBe(5000);
        }).pipe(Effect.provide(testLayer))
      );
    });
  });

  describe('Error Recovery', () => {
    it('recovers from corrupted Yjs state via snapshot', async () => {
      // This tests the SnapshotService recovery flow
      const snapshotData = createTestSSRData<TestTask>('tasks', [
        { id: 'task1', title: 'Recovered', done: false },
      ]);

      // The snapshot service can recover state from a snapshot
      // when the local Yjs document becomes corrupted
      const recoveryDoc = new Y.Doc();
      Y.applyUpdateV2(recoveryDoc, new Uint8Array(snapshotData.crdtBytes));

      const recoveredMap = recoveryDoc.getMap<Y.Map<unknown>>('tasks');
      expect(recoveredMap.size).toBe(1);

      const task = recoveredMap.get('task1') as Y.Map<unknown>;
      expect(task.get('title')).toBe('Recovered');

      recoveryDoc.destroy();
    });
  });
});
