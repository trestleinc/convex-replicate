import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createTestYjsClient, syncYjsClients } from '../utils/yjs-helpers.js';

describe('CRDT Conflict Resolution', () => {
  it('resolves concurrent inserts to different keys', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    // Both clients insert different tasks while offline
    clientA.map.set('task1', { title: 'Task from A' });
    clientB.map.set('task2', { title: 'Task from B' });

    // Reconnect - sync updates
    syncYjsClients(clientA, clientB);

    // Both clients have both tasks
    expect(clientA.map.size).toBe(2);
    expect(clientB.map.size).toBe(2);
    expect(clientA.map.get('task1')).toEqual({ title: 'Task from A' });
    expect(clientA.map.get('task2')).toEqual({ title: 'Task from B' });
    expect(clientB.map.get('task1')).toEqual({ title: 'Task from A' });
    expect(clientB.map.get('task2')).toEqual({ title: 'Task from B' });

    clientA.cleanup();
    clientB.cleanup();
  });

  it('merges concurrent updates to same document (different fields)', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    // Start with synced state - create nested Y.Map
    const task = new Y.Map();
    task.set('title', 'Original Title');
    task.set('done', false);
    task.set('priority', 'low');

    clientA.map.set('task1', task);

    // Sync to B
    syncYjsClients(clientA, clientB);

    // Get references to the same task on both clients
    const taskA = clientA.map.get('task1') as Y.Map<any>;
    const taskB = clientB.map.get('task1') as Y.Map<any>;

    // Disconnect and make different changes
    // Client A changes title
    taskA.set('title', 'New Title from A');

    // Client B changes done status
    taskB.set('done', true);

    // Reconnect
    syncYjsClients(clientA, clientB);

    // Both clients have MERGED state
    expect(taskA.get('title')).toBe('New Title from A');
    expect(taskA.get('done')).toBe(true);
    expect(taskA.get('priority')).toBe('low'); // Unchanged

    expect(taskB.get('title')).toBe('New Title from A');
    expect(taskB.get('done')).toBe(true);
    expect(taskB.get('priority')).toBe('low'); // Unchanged

    clientA.cleanup();
    clientB.cleanup();
  });

  it('applies last-write-wins for same field updates', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    // Both clients modify same field offline
    clientA.map.set('task1', { title: 'Title from A', timestamp: 1 });
    clientB.map.set('task1', { title: 'Title from B', timestamp: 2 });

    // Reconnect - Yjs uses Lamport timestamps for conflict resolution
    syncYjsClients(clientA, clientB);

    // Both clients converge to same value
    const valueA = clientA.map.get('task1');
    const valueB = clientB.map.get('task1');

    expect(valueA).toEqual(valueB); // Convergence is key
    // The actual winner depends on (clock, clientId) tuple
    // We just verify they agree

    clientA.cleanup();
    clientB.cleanup();
  });

  it('resolves delete vs update conflict', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    // Start synced
    clientA.map.set('task1', { title: 'Task 1' });
    syncYjsClients(clientA, clientB);

    // Disconnect
    // Client A deletes
    clientA.map.delete('task1');

    // Client B updates
    clientB.map.set('task1', { title: 'Updated Task 1', done: true });

    // Reconnect
    syncYjsClients(clientA, clientB);

    // Yjs CRDTs: operations are timestamped, convergence guaranteed
    // Verify both clients have same state
    expect(clientA.map.has('task1')).toBe(clientB.map.has('task1'));

    if (clientA.map.has('task1')) {
      expect(clientA.map.get('task1')).toEqual(clientB.map.get('task1'));
    }

    clientA.cleanup();
    clientB.cleanup();
  });

  it('handles concurrent deletions of same item', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    // Start synced
    clientA.map.set('task1', { title: 'Task 1' });
    clientA.map.set('task2', { title: 'Task 2' });
    syncYjsClients(clientA, clientB);

    // Both delete same item
    clientA.map.delete('task1');
    clientB.map.delete('task1');

    // Reconnect
    syncYjsClients(clientA, clientB);

    // Both should agree task1 is deleted
    expect(clientA.map.has('task1')).toBe(false);
    expect(clientB.map.has('task1')).toBe(false);

    // task2 should still exist
    expect(clientA.map.has('task2')).toBe(true);
    expect(clientB.map.has('task2')).toBe(true);

    clientA.cleanup();
    clientB.cleanup();
  });

  it('resolves complex multi-field concurrent updates', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    // Create complex nested structure
    const task = new Y.Map();
    task.set('title', 'Original');
    task.set('done', false);
    task.set('priority', 'low');
    task.set('tags', ['work']);
    task.set('assignee', 'Alice');

    clientA.map.set('task1', task);
    syncYjsClients(clientA, clientB);

    const taskA = clientA.map.get('task1') as Y.Map<any>;
    const taskB = clientB.map.get('task1') as Y.Map<any>;

    // Disconnect and make multiple changes
    // Client A
    taskA.set('title', 'New Title A');
    taskA.set('done', true);
    taskA.set('priority', 'high');

    // Client B
    taskB.set('assignee', 'Bob');
    taskB.set('tags', ['work', 'urgent']);

    // Reconnect
    syncYjsClients(clientA, clientB);

    // Verify convergence - both should have same state
    expect(taskA.get('title')).toBe(taskB.get('title'));
    expect(taskA.get('done')).toBe(taskB.get('done'));
    expect(taskA.get('priority')).toBe(taskB.get('priority'));
    expect(taskA.get('assignee')).toBe(taskB.get('assignee'));
    expect(taskA.get('tags')).toEqual(taskB.get('tags'));

    clientA.cleanup();
    clientB.cleanup();
  });

  it('handles rapid fire concurrent operations', () => {
    const clientA = createTestYjsClient('tasks');
    const clientB = createTestYjsClient('tasks');

    // Client A makes 50 changes
    for (let i = 0; i < 50; i++) {
      clientA.map.set(`taskA${i}`, { title: `Task A${i}`, from: 'A' });
    }

    // Client B makes 50 changes
    for (let i = 0; i < 50; i++) {
      clientB.map.set(`taskB${i}`, { title: `Task B${i}`, from: 'B' });
    }

    // Sync
    syncYjsClients(clientA, clientB);

    // Both should have all 100 tasks
    expect(clientA.map.size).toBe(100);
    expect(clientB.map.size).toBe(100);

    // Verify convergence
    for (let i = 0; i < 50; i++) {
      expect(clientA.map.get(`taskA${i}`)).toEqual(clientB.map.get(`taskA${i}`));
      expect(clientA.map.get(`taskB${i}`)).toEqual(clientB.map.get(`taskB${i}`));
    }

    clientA.cleanup();
    clientB.cleanup();
  });
});
