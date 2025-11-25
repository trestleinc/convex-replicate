import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createTestYjsClient,
  syncYjsClients,
  setupBidirectionalSync,
  syncWithStateVectors,
} from '../utils/yjs-helpers.js';

describe('Two-Client Synchronization', () => {
  it('syncs insert from client A to client B', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    // Setup bidirectional sync
    const cleanup = setupBidirectionalSync(clientA, clientB);

    // Client A inserts data
    clientA.map.set('task1', { title: 'Buy milk', done: false });

    // Verify it synced to Client B
    expect(clientB.map.get('task1')).toEqual({ title: 'Buy milk', done: false });

    cleanup();
    clientA.cleanup();
    clientB.cleanup();
  });

  it('syncs bidirectional changes', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    const cleanup = setupBidirectionalSync(clientA, clientB);

    // Client A adds task1
    clientA.map.set('task1', { title: 'Task A' });

    // Client B adds task2
    clientB.map.set('task2', { title: 'Task B' });

    // Both clients should have both tasks
    expect(clientA.map.get('task1')).toBeDefined();
    expect(clientA.map.get('task2')).toBeDefined();
    expect(clientB.map.get('task1')).toBeDefined();
    expect(clientB.map.get('task2')).toBeDefined();

    cleanup();
    clientA.cleanup();
    clientB.cleanup();
  });

  it('syncs changes when updates are delayed', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    // Client A makes changes while B is offline
    clientA.map.set('task1', { title: 'Task 1' });
    clientA.map.set('task2', { title: 'Task 2' });
    clientA.map.set('task3', { title: 'Task 3' });

    // Client B is offline - no updates received yet
    expect(clientB.map.size).toBe(0);

    // Client B comes online - apply all pending updates
    syncYjsClients(clientA, clientB);

    // Now Client B has all 3 tasks
    expect(clientB.map.size).toBe(3);
    expect(clientB.map.get('task1')).toBeDefined();
    expect(clientB.map.get('task2')).toBeDefined();
    expect(clientB.map.get('task3')).toBeDefined();

    clientA.cleanup();
    clientB.cleanup();
  });

  it('syncs efficiently using state vectors', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    // Client A has 100 tasks
    for (let i = 0; i < 100; i++) {
      clientA.map.set(`task${i}`, { title: `Task ${i}` });
    }

    // Efficient sync using state vectors
    syncWithStateVectors(clientA, clientB);

    // Client B now has all 100 tasks
    expect(clientB.map.size).toBe(100);
    expect(clientB.map.get('task0')).toBeDefined();
    expect(clientB.map.get('task99')).toBeDefined();

    clientA.cleanup();
    clientB.cleanup();
  });

  it('handles rapid sequential updates', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    const cleanup = setupBidirectionalSync(clientA, clientB);

    // Rapid updates
    for (let i = 0; i < 10; i++) {
      clientA.map.set(`task${i}`, { title: `Task ${i}`, count: i });
    }

    // All updates should sync
    expect(clientB.map.size).toBe(10);
    expect(clientB.map.get('task0')).toEqual({ title: 'Task 0', count: 0 });
    expect(clientB.map.get('task9')).toEqual({ title: 'Task 9', count: 9 });

    cleanup();
    clientA.cleanup();
    clientB.cleanup();
  });

  it('syncs nested Y.Map structures', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    const cleanup = setupBidirectionalSync(clientA, clientB);

    // Create nested Y.Map
    const task = new Y.Map();
    task.set('title', 'Complex Task');
    task.set('done', false);
    task.set('priority', 'high');

    clientA.map.set('task1', task);

    // Verify nested structure synced
    const syncedTask = clientB.map.get('task1') as Y.Map<any>;
    expect(syncedTask).toBeInstanceOf(Y.Map);
    expect(syncedTask.get('title')).toBe('Complex Task');
    expect(syncedTask.get('done')).toBe(false);
    expect(syncedTask.get('priority')).toBe('high');

    cleanup();
    clientA.cleanup();
    clientB.cleanup();
  });

  it('syncs deletions', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    const cleanup = setupBidirectionalSync(clientA, clientB);

    // Add tasks
    clientA.map.set('task1', { title: 'Task 1' });
    clientA.map.set('task2', { title: 'Task 2' });
    clientA.map.set('task3', { title: 'Task 3' });

    expect(clientB.map.size).toBe(3);

    // Delete task2
    clientA.map.delete('task2');

    // Deletion should sync
    expect(clientB.map.size).toBe(2);
    expect(clientB.map.has('task1')).toBe(true);
    expect(clientB.map.has('task2')).toBe(false);
    expect(clientB.map.has('task3')).toBe(true);

    cleanup();
    clientA.cleanup();
    clientB.cleanup();
  });
});
