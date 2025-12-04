/**
 * Integration tests for conflict resolution
 *
 * Tests the core CRDT value proposition: concurrent edits merge automatically.
 * This is the most important test file.
 */
import { describe, expect, it } from 'vitest';
import { createTestCollection, syncCollections } from '../utils/collection.js';
import { applyUpdate } from '../utils/yjs.js';

interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  priority?: number;
}

describe('conflict resolution', () => {
  it('merges concurrent inserts to different keys', () => {
    const client1 = createTestCollection<Task>('tasks', 1);
    const client2 = createTestCollection<Task>('tasks', 2);

    // Both clients start empty, insert different tasks
    client1.insert({ id: 'task-a', title: 'Task A', completed: false });
    client2.insert({ id: 'task-b', title: 'Task B', completed: false });

    // Sync
    syncCollections(client1, client2);

    // Both should have both tasks
    expect(client1.getAll()).toHaveLength(2);
    expect(client2.getAll()).toHaveLength(2);

    expect(client1.get('task-a')?.title).toBe('Task A');
    expect(client1.get('task-b')?.title).toBe('Task B');
    expect(client2.get('task-a')?.title).toBe('Task A');
    expect(client2.get('task-b')?.title).toBe('Task B');
  });

  it('merges concurrent updates to same document, different fields', () => {
    const client1 = createTestCollection<Task>('tasks', 1);
    const client2 = createTestCollection<Task>('tasks', 2);

    // Start with same document on both (simulate initial sync)
    client1.insert({ id: 'task-1', title: 'Original', completed: false });
    syncCollections(client1, client2);

    // Client 1 updates title
    client1.update('task-1', { title: 'Updated by client 1' });

    // Client 2 updates completed (concurrent, no sync yet)
    client2.update('task-1', { completed: true });

    // Sync
    syncCollections(client1, client2);

    // Both fields should be updated
    const task1 = client1.get('task-1');
    const task2 = client2.get('task-1');

    expect(task1?.title).toBe('Updated by client 1');
    expect(task1?.completed).toBe(true);
    expect(task2?.title).toBe('Updated by client 1');
    expect(task2?.completed).toBe(true);
  });

  it('last-write-wins for same field edits (converges to same value)', () => {
    const client1 = createTestCollection<Task>('tasks', 1);
    const client2 = createTestCollection<Task>('tasks', 2);

    // Start with same document
    client1.insert({ id: 'task-1', title: 'Original', completed: false });
    syncCollections(client1, client2);

    // Both update the same field
    client1.update('task-1', { title: 'Title from client 1' });
    client2.update('task-1', { title: 'Title from client 2' });

    // Sync
    syncCollections(client1, client2);

    // Both clients should converge to the same value
    // (Yjs uses lamport clocks + clientId for deterministic conflict resolution)
    const title1 = client1.get('task-1')?.title;
    const title2 = client2.get('task-1')?.title;
    expect(title1).toBe(title2);
    // One of the values wins - the important thing is convergence
    expect(['Title from client 1', 'Title from client 2']).toContain(title1);
  });

  it('preserves both changes for different field edits', () => {
    const client1 = createTestCollection<Task>('tasks', 1);
    const client2 = createTestCollection<Task>('tasks', 2);

    // Start with task having multiple fields
    client1.insert({
      id: 'task-1',
      title: 'Original',
      description: 'Original description',
      completed: false,
      priority: 1,
    });
    syncCollections(client1, client2);

    // Client 1 updates title and priority
    client1.update('task-1', { title: 'New title', priority: 3 });

    // Client 2 updates description and completed
    client2.update('task-1', { description: 'New description', completed: true });

    // Sync
    syncCollections(client1, client2);

    // All changes should be preserved
    const task = client1.get('task-1');
    expect(task).toEqual({
      id: 'task-1',
      title: 'New title',
      description: 'New description',
      completed: true,
      priority: 3,
    });
  });

  it('handles delete vs update conflict (delete wins)', () => {
    const client1 = createTestCollection<Task>('tasks', 1);
    const client2 = createTestCollection<Task>('tasks', 2);

    // Start with same document
    client1.insert({ id: 'task-1', title: 'Original', completed: false });
    syncCollections(client1, client2);

    // Client 1 deletes
    client1.delete('task-1');

    // Client 2 updates (concurrent)
    client2.update('task-1', { title: 'Updated' });

    // Sync
    syncCollections(client1, client2);

    // In Yjs Y.Map, the delete removes the key
    // The update modifies the Y.Map that was deleted
    // After sync, the item is deleted (Y.Map key removed)
    expect(client1.get('task-1')).toBeNull();
    expect(client2.get('task-1')).toBeNull();
  });

  it('handles concurrent deletes', () => {
    const client1 = createTestCollection<Task>('tasks', 1);
    const client2 = createTestCollection<Task>('tasks', 2);

    // Start with same document
    client1.insert({ id: 'task-1', title: 'To be deleted', completed: false });
    syncCollections(client1, client2);

    // Both delete
    client1.delete('task-1');
    client2.delete('task-1');

    // Sync (should be idempotent)
    syncCollections(client1, client2);

    expect(client1.get('task-1')).toBeNull();
    expect(client2.get('task-1')).toBeNull();
  });

  it('maintains eventual consistency after multiple rounds', () => {
    const client1 = createTestCollection<Task>('tasks', 1);
    const client2 = createTestCollection<Task>('tasks', 2);
    const client3 = createTestCollection<Task>('tasks', 3);

    // Round 1: client1 inserts
    client1.insert({ id: 'task-1', title: 'From client 1', completed: false });

    // Sync 1 -> 2
    const _delta1to2 = { delta: applyUpdate(client2.doc, getState(client1)) };

    // Round 2: client2 updates
    client2.update('task-1', { completed: true });

    // Client3 inserts (doesn't know about task-1 yet)
    client3.insert({ id: 'task-2', title: 'From client 3', completed: false });

    // Full sync all three
    syncCollections(client1, client2);
    syncCollections(client2, client3);
    syncCollections(client1, client3);

    // All three should converge
    const allTasks1 = client1.getAll().sort((a, b) => a.id.localeCompare(b.id));
    const allTasks2 = client2.getAll().sort((a, b) => a.id.localeCompare(b.id));
    const allTasks3 = client3.getAll().sort((a, b) => a.id.localeCompare(b.id));

    expect(allTasks1).toEqual(allTasks2);
    expect(allTasks2).toEqual(allTasks3);

    expect(allTasks1).toHaveLength(2);
    expect(allTasks1[0].id).toBe('task-1');
    expect(allTasks1[0].completed).toBe(true);
    expect(allTasks1[1].id).toBe('task-2');
  });

  it('handles rapid concurrent edits', () => {
    const client1 = createTestCollection<Task>('tasks', 1);
    const client2 = createTestCollection<Task>('tasks', 2);

    // Start with same document
    client1.insert({ id: 'task-1', title: 'v0', completed: false, priority: 0 });
    syncCollections(client1, client2);

    // Rapid edits on both sides
    for (let i = 1; i <= 10; i++) {
      client1.update('task-1', { title: `v${i} from client1`, priority: i });
      client2.update('task-1', { title: `v${i} from client2`, priority: i * 10 });
    }

    // Final sync
    syncCollections(client1, client2);

    // Both clients should converge to the same state
    // Yjs uses lamport timestamps + clientId for deterministic resolution
    const task1 = client1.get('task-1');
    const task2 = client2.get('task-1');

    // The key assertion: both clients have identical state after sync
    expect(task1).toEqual(task2);

    // One of the final values must win (we don't assume which)
    expect(['v10 from client1', 'v10 from client2']).toContain(task1?.title);
    expect([10, 100]).toContain(task1?.priority);
  });
});

// Helper to get full state as update
import * as Y from 'yjs';
function getState(collection: { doc: Y.Doc }): Uint8Array {
  return Y.encodeStateAsUpdateV2(collection.doc);
}
