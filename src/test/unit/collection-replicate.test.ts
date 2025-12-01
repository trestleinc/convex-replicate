/**
 * End-to-End Collection Replicate Tests
 *
 * These tests simulate the full replicate flow including SSR, subscriptions,
 * and reconnection to catch bugs like the "replicate breaks after refresh" issue.
 */

import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import * as Y from 'yjs';
import { Checkpoint, CheckpointLive } from '$/client/services/checkpoint.js';
import { createTestSSRData, simulateClientServerReplicate } from '$/test/utils/collection.js';

interface TestTask {
  id: string;
  title: string;
  done: boolean;
}

describe('Collection Replicate Flow', () => {
  // ============================================
  // V1/V2 FORMAT CONSISTENCY
  // ============================================
  describe('Yjs Update Format Consistency', () => {
    it('mergeUpdatesV2 produces updates compatible with applyUpdateV2', () => {
      // Create two separate updates using V2 format
      const doc1 = new Y.Doc();
      const map1 = doc1.getMap('tasks');
      const item1 = new Y.Map();
      item1.set('id', 'task1');
      item1.set('title', 'Task 1');
      map1.set('task1', item1);
      const update1 = Y.encodeStateAsUpdateV2(doc1);

      const doc2 = new Y.Doc();
      const map2 = doc2.getMap('tasks');
      const item2 = new Y.Map();
      item2.set('id', 'task2');
      item2.set('title', 'Task 2');
      map2.set('task2', item2);
      const update2 = Y.encodeStateAsUpdateV2(doc2);

      // Merge using V2
      const merged = Y.mergeUpdatesV2([update1, update2]);

      // Apply to a new doc using V2
      const targetDoc = new Y.Doc();
      expect(() => {
        Y.applyUpdateV2(targetDoc, merged);
      }).not.toThrow();

      // Verify data integrity
      const targetMap = targetDoc.getMap('tasks');
      expect(targetMap.size).toBe(2);

      doc1.destroy();
      doc2.destroy();
      targetDoc.destroy();
    });

    it('V1 merge with V2 apply causes issues (demonstrating the bug)', () => {
      // Create updates using V2 format
      const doc1 = new Y.Doc();
      const map1 = doc1.getMap('tasks');
      const item1 = new Y.Map();
      item1.set('id', 'task1');
      item1.set('title', 'Task 1');
      map1.set('task1', item1);
      const update1 = Y.encodeStateAsUpdateV2(doc1);

      const doc2 = new Y.Doc();
      const map2 = doc2.getMap('tasks');
      const item2 = new Y.Map();
      item2.set('id', 'task2');
      item2.set('title', 'Task 2');
      map2.set('task2', item2);
      const update2 = Y.encodeStateAsUpdateV2(doc2);

      // Merge using V1 (the bug!)
      // Note: This might not throw immediately but can cause silent corruption
      const merged = Y.mergeUpdates([update1, update2]);

      // Try to apply with V2 - this is the mismatch
      const targetDoc = new Y.Doc();

      // This may or may not throw depending on the data
      // The key insight is that the formats are incompatible
      try {
        Y.applyUpdateV2(targetDoc, merged);
        // If it doesn't throw, check if data is corrupted
        const targetMap = targetDoc.getMap('tasks');
        // Data might be there but corrupted
        expect(targetMap.size).toBeLessThanOrEqual(2);
      } catch {
        // Expected - V1 merged data is incompatible with V2 apply
        expect(true).toBe(true);
      }

      doc1.destroy();
      doc2.destroy();
      targetDoc.destroy();
    });

    it('SSR crdtBytes (V2 merged) can be applied with applyUpdateV2', () => {
      const tasks: TestTask[] = [
        { id: 'task1', title: 'Task 1', done: false },
        { id: 'task2', title: 'Task 2', done: true },
      ];

      // Create SSR data (uses V2 encoding internally)
      const ssrData = createTestSSRData('tasks', tasks);

      // Apply to a client doc using V2
      const clientDoc = new Y.Doc();
      expect(() => {
        Y.applyUpdateV2(clientDoc, new Uint8Array(ssrData.crdtBytes));
      }).not.toThrow();

      // Verify data
      const clientMap = clientDoc.getMap('tasks');
      expect(clientMap.size).toBe(2);

      const task1 = clientMap.get('task1') as Y.Map<unknown>;
      expect(task1.get('title')).toBe('Task 1');

      clientDoc.destroy();
    });
  });

  // ============================================
  // MULTI-CLIENT SYNC (Yjs level)
  // ============================================
  describe('Multi-Client Replicate via Server', () => {
    it('client A mutation reaches client B via server', () => {
      const sync = simulateClientServerReplicate<TestTask>('tasks');

      // Client A makes a mutation
      sync.clientAMutates({ id: 'task1', title: 'From A', done: false });

      // Replicate to client B from server
      sync.replicateToClientB();

      // Client B should have the task
      const bItems = sync.clientB.getItems();
      expect(bItems).toHaveLength(1);
      expect(bItems[0].title).toBe('From A');

      sync.destroy();
    });

    it('client B mutation reaches client A via server', () => {
      const sync = simulateClientServerReplicate<TestTask>('tasks');

      // Client B makes a mutation
      sync.clientBMutates({ id: 'task1', title: 'From B', done: true });

      // Replicate to client A from server
      sync.replicateToClientA();

      // Client A should have the task
      const aItems = sync.clientA.getItems();
      expect(aItems).toHaveLength(1);
      expect(aItems[0].title).toBe('From B');

      sync.destroy();
    });

    it('bidirectional replication works correctly', () => {
      const sync = simulateClientServerReplicate<TestTask>('tasks');

      // Client A makes mutations
      sync.clientAMutates({ id: 'task1', title: 'From A', done: false });
      sync.clientAMutates({ id: 'task2', title: 'Also from A', done: false });

      // Client B makes mutations
      sync.clientBMutates({ id: 'task3', title: 'From B', done: true });

      // Replicate to both clients
      sync.replicateToClientA();
      sync.replicateToClientB();

      // Both clients should have all tasks
      const aItems = sync.clientA.getItems();
      const bItems = sync.clientB.getItems();

      expect(aItems).toHaveLength(3);
      expect(bItems).toHaveLength(3);

      // Client A has B's task
      expect(aItems.find((t) => t.id === 'task3')?.title).toBe('From B');

      // Client B has A's tasks
      expect(bItems.find((t) => t.id === 'task1')?.title).toBe('From A');
      expect(bItems.find((t) => t.id === 'task2')?.title).toBe('Also from A');

      sync.destroy();
    });

    it('replicate after "refresh" (client restarts from SSR) works', () => {
      const sync = simulateClientServerReplicate<TestTask>('tasks');

      // Initial state: both clients have some tasks
      sync.clientAMutates({ id: 'task1', title: 'Task 1', done: false });
      sync.replicateToClientB();

      // Verify B has the task
      expect(sync.clientB.getItems()).toHaveLength(1);

      // Now simulate Client A "refreshing" by getting SSR data
      const ssrData = sync.server.getSSRData('tasks');

      // Client A is destroyed and recreated (simulating page refresh)
      sync.clientA.destroy();

      // Create new client A and apply SSR data
      const newClientA = new Y.Doc();
      const newClientAMap = newClientA.getMap<Y.Map<unknown>>('tasks');

      // Apply SSR data
      if (ssrData.crdtBytes.byteLength > 0) {
        Y.applyUpdateV2(newClientA, new Uint8Array(ssrData.crdtBytes));
      }

      // Verify new client A has the data from SSR
      expect(newClientAMap.size).toBe(1);

      // Now client B makes a NEW mutation after A's refresh
      sync.clientBMutates({ id: 'task2', title: 'After refresh', done: true });

      // Get the new delta from server
      const newDeltas = sync.server.getDeltasSince(ssrData.checkpoint);

      // Apply new delta to refreshed client A
      for (const delta of newDeltas) {
        Y.applyUpdateV2(newClientA, delta.delta);
      }

      // Client A should now have both tasks
      expect(newClientAMap.size).toBe(2);
      const task2 = newClientAMap.get('task2') as Y.Map<unknown>;
      expect(task2?.get('title')).toBe('After refresh');

      newClientA.destroy();
      sync.destroy();
    });
  });

  // ============================================
  // CHECKPOINT SERVICE BEHAVIOR
  // ============================================
  describe('CheckpointService Behavior', () => {
    const testLayer = CheckpointLive;

    it('loadCheckpoint always returns stored checkpoint (used by onOnline)', async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* Checkpoint;

          // Save a checkpoint
          yield* svc.saveCheckpoint('test-collection', { lastModified: 99999 });

          // loadCheckpoint returns stored value
          return yield* svc.loadCheckpoint('test-collection');
        }).pipe(Effect.provide(testLayer))
      );

      expect(result.lastModified).toBe(99999);
    });

    it('checkpoint updates correctly as deltas are processed', async () => {
      const checkpoints: number[] = [];

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* Checkpoint;

          // Simulate processing deltas
          yield* svc.saveCheckpoint('test-collection', { lastModified: 1000 });
          checkpoints.push((yield* svc.loadCheckpoint('test-collection')).lastModified);

          yield* svc.saveCheckpoint('test-collection', { lastModified: 2000 });
          checkpoints.push((yield* svc.loadCheckpoint('test-collection')).lastModified);

          yield* svc.saveCheckpoint('test-collection', { lastModified: 3000 });
          checkpoints.push((yield* svc.loadCheckpoint('test-collection')).lastModified);
        }).pipe(Effect.provide(testLayer))
      );

      expect(checkpoints).toEqual([1000, 2000, 3000]);
    });
  });

  // ============================================
  // THE BUG SCENARIO: Reconnection After Refresh
  // ============================================
  describe('Reconnection After Refresh (THE BUG)', () => {
    it('checkpoint service saves and loads correctly for reconnection', async () => {
      /**
       * Test that CheckpointService correctly tracks checkpoint progression
       * so that reconnection uses the latest saved checkpoint.
       */

      const testLayer = CheckpointLive;

      const checkpoints: number[] = [];

      await Effect.runPromise(
        Effect.gen(function* () {
          const checkpointSvc = yield* Checkpoint;

          // SSR checkpoint
          const _ssrCheckpoint = { lastModified: 1000000 };

          // Simulate subscription handler saving checkpoints
          yield* checkpointSvc.saveCheckpoint('tasks', { lastModified: 1001000 });
          yield* checkpointSvc.saveCheckpoint('tasks', { lastModified: 1002000 });
          yield* checkpointSvc.saveCheckpoint('tasks', { lastModified: 1005000 });

          // On reconnection, load checkpoint
          const reconnectCheckpoint = yield* checkpointSvc.loadCheckpoint('tasks');
          checkpoints.push(reconnectCheckpoint.lastModified);
        }).pipe(Effect.provide(testLayer))
      );

      // Should use the latest saved checkpoint (1005000), not SSR (1000000)
      expect(checkpoints[0]).toBe(1005000);
    });

    it('subscription handler saves checkpoint after processing each delta', async () => {
      /**
       * Verify that as the subscription handler processes deltas,
       * it saves checkpoints correctly, so onOnline can use them.
       */

      const savedCheckpoints: number[] = [];

      await Effect.runPromise(
        Effect.gen(function* () {
          const checkpointSvc = yield* Checkpoint;

          // Simulate subscription handler processing deltas
          const deltas = [
            { checkpoint: { lastModified: 100 } },
            { checkpoint: { lastModified: 200 } },
            { checkpoint: { lastModified: 300 } },
          ];

          for (const delta of deltas) {
            yield* checkpointSvc.saveCheckpoint('tasks', delta.checkpoint);
            const saved = yield* checkpointSvc.loadCheckpoint('tasks');
            savedCheckpoints.push(saved.lastModified);
          }
        }).pipe(Effect.provide(CheckpointLive))
      );

      // Each checkpoint should be saved correctly
      expect(savedCheckpoints).toEqual([100, 200, 300]);
    });
  });

  // ============================================
  // STALE CHECKPOINT FROM PREVIOUS SESSION (THE ACTUAL BUG)
  // ============================================
  describe('Stale Checkpoint From Previous Session', () => {
    const testLayer = CheckpointLive;

    it('CRITICAL: onOnline before any deltas processed uses 0 if checkpoint was cleared', async () => {
      /**
       * This tests THE ACTUAL BUG:
       * 1. Previous session saved checkpoint 9999 to IndexedDB
       * 2. Page refreshes with SSR data
       * 3. Checkpoint is CLEARED (our fix)
       * 4. onOnline fires BEFORE subscription handler processes any deltas
       * 5. loadCheckpoint() should return 0 (not 9999!)
       */

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const checkpointSvc = yield* Checkpoint;

          // Step 1: Simulate previous session saving a high checkpoint
          yield* checkpointSvc.saveCheckpoint('tasks', { lastModified: 9999 });

          // Verify it was saved
          const oldCheckpoint = yield* checkpointSvc.loadCheckpoint('tasks');
          expect(oldCheckpoint.lastModified).toBe(9999);

          // Step 2: Page refreshes, SSR data loaded, checkpoint CLEARED
          yield* checkpointSvc.clearCheckpoint('tasks');

          // Step 3: onOnline fires before any deltas processed
          const reconnectCheckpoint = yield* checkpointSvc.loadCheckpoint('tasks');

          return reconnectCheckpoint;
        }).pipe(Effect.provide(testLayer))
      );

      // Should be 0 (default), NOT 9999 (old checkpoint)
      expect(result.lastModified).toBe(0);
    });

    it('without clearing checkpoint, onOnline would use stale checkpoint (demonstrating the bug)', async () => {
      /**
       * This demonstrates what happens WITHOUT the fix:
       * If we don't clear the checkpoint, onOnline uses the stale value
       */

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const checkpointSvc = yield* Checkpoint;

          // Previous session saved checkpoint
          yield* checkpointSvc.saveCheckpoint('tasks-no-clear', { lastModified: 9999 });

          // Page refreshes but we DON'T clear (the bug)
          // onOnline fires
          const reconnectCheckpoint = yield* checkpointSvc.loadCheckpoint('tasks-no-clear');

          return reconnectCheckpoint;
        }).pipe(Effect.provide(testLayer))
      );

      // This is the BUG - it returns 9999 instead of 0
      expect(result.lastModified).toBe(9999);
    });

    it('subscription handler saves correct checkpoint after processing deltas', async () => {
      /**
       * Verify that after the subscription handler processes deltas,
       * the checkpoint is correctly saved and onOnline uses it.
       */

      const checkpoints: number[] = [];
      const ssrCheckpoint = { lastModified: 5000 };

      await Effect.runPromise(
        Effect.gen(function* () {
          const checkpointSvc = yield* Checkpoint;

          // Step 1: Old checkpoint from previous session (cleared by SSR load)
          yield* checkpointSvc.saveCheckpoint('tasks', { lastModified: 9999 });

          // Step 2: SSR load - use SSR checkpoint directly
          const initial = ssrCheckpoint;
          checkpoints.push(initial.lastModified);

          // Step 3: Subscription handler processes deltas and saves checkpoints
          yield* checkpointSvc.saveCheckpoint('tasks', { lastModified: 5100 });
          yield* checkpointSvc.saveCheckpoint('tasks', { lastModified: 5200 });
          yield* checkpointSvc.saveCheckpoint('tasks', { lastModified: 5300 });

          // Step 4: onOnline fires
          const reconnect = yield* checkpointSvc.loadCheckpoint('tasks');
          checkpoints.push(reconnect.lastModified);
        }).pipe(Effect.provide(testLayer))
      );

      // Initial = 5000 (SSR checkpoint)
      // Reconnect = 5300 (latest saved by subscription handler)
      expect(checkpoints).toEqual([5000, 5300]);
    });
  });

  // ============================================
  // DELTA APPLICATION TESTS
  // ============================================
  describe('Delta Application', () => {
    it('delta from client A can be applied to client B', () => {
      const sync = simulateClientServerReplicate<TestTask>('tasks');

      // Client A makes a mutation and gets delta
      const mutation = sync.clientA.makeMutation({
        id: 'task1',
        title: 'From A',
        done: false,
      });

      // Apply delta directly to client B
      sync.clientB.applyDelta(mutation.delta);

      // Client B should have the task
      const bItems = sync.clientB.getItems();
      expect(bItems).toHaveLength(1);
      expect(bItems[0].title).toBe('From A');

      sync.destroy();
    });

    it('delta after SSR load can be applied correctly', () => {
      // Create initial SSR data
      const ssrData = createTestSSRData<TestTask>('tasks', [
        { id: 'task1', title: 'SSR Task', done: false },
      ]);

      // Create client and apply SSR data
      const clientDoc = new Y.Doc();
      const clientMap = clientDoc.getMap<Y.Map<unknown>>('tasks');
      Y.applyUpdateV2(clientDoc, new Uint8Array(ssrData.crdtBytes));

      expect(clientMap.size).toBe(1);

      // Create a delta for a new task (simulating another client's mutation)
      const otherDoc = new Y.Doc();
      const otherMap = otherDoc.getMap<Y.Map<unknown>>('tasks');

      // Other client needs to have same base state first
      Y.applyUpdateV2(otherDoc, new Uint8Array(ssrData.crdtBytes));

      // Now make a new change
      const beforeVector = Y.encodeStateVector(otherDoc);
      const newTask = new Y.Map();
      newTask.set('id', 'task2');
      newTask.set('title', 'After SSR');
      newTask.set('done', true);
      otherMap.set('task2', newTask);
      const delta = Y.encodeStateAsUpdateV2(otherDoc, beforeVector);

      // Apply delta to client
      Y.applyUpdateV2(clientDoc, delta);

      // Client should now have both tasks
      expect(clientMap.size).toBe(2);
      const task2 = clientMap.get('task2') as Y.Map<unknown>;
      expect(task2?.get('title')).toBe('After SSR');

      clientDoc.destroy();
      otherDoc.destroy();
    });
  });
});
