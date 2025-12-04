/**
 * Integration tests for CRUD operations
 *
 * Tests the full insert → update → delete cycle using test collections.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createTestCollection } from '../utils/collection.js';
import { applyUpdate } from '../utils/yjs.js';

interface Task {
  id: string;
  title: string;
  completed: boolean;
}

describe('CRUD operations', () => {
  it('insert creates Y.Map entry with correct structure', () => {
    const collection = createTestCollection<Task>('tasks');

    const task: Task = {
      id: 'task-1',
      title: 'Test task',
      completed: false,
    };

    collection.insert(task);

    // Verify the item exists
    const retrieved = collection.get('task-1');
    expect(retrieved).toEqual(task);

    // Verify internal Y.Map structure
    const ymap = collection.ymap;
    const itemMap = ymap.get('task-1');
    expect(itemMap).toBeInstanceOf(Y.Map);
    expect((itemMap as Y.Map<unknown>).get('id')).toBe('task-1');
    expect((itemMap as Y.Map<unknown>).get('title')).toBe('Test task');
    expect((itemMap as Y.Map<unknown>).get('completed')).toBe(false);
  });

  it('update modifies existing entry', () => {
    const collection = createTestCollection<Task>('tasks');

    // Insert initial task
    collection.insert({
      id: 'task-1',
      title: 'Original title',
      completed: false,
    });

    // Update the task
    collection.update('task-1', {
      title: 'Updated title',
      completed: true,
    });

    const updated = collection.get('task-1');
    expect(updated).toEqual({
      id: 'task-1',
      title: 'Updated title',
      completed: true,
    });
  });

  it('delete removes entry from Y.Map', () => {
    const collection = createTestCollection<Task>('tasks');

    collection.insert({
      id: 'task-1',
      title: 'Task to delete',
      completed: false,
    });

    // Verify it exists
    expect(collection.get('task-1')).not.toBeNull();

    // Delete it
    collection.delete('task-1');

    // Verify it's gone
    expect(collection.get('task-1')).toBeNull();
    expect(collection.ymap.has('task-1')).toBe(false);
  });

  it('operations produce valid CRDT deltas', () => {
    const collection1 = createTestCollection<Task>('tasks', 1);
    const collection2 = createTestCollection<Task>('tasks', 2);

    // Insert on collection1
    const { delta: insertDelta } = collection1.insert({
      id: 'task-1',
      title: 'Task from collection 1',
      completed: false,
    });

    // Apply delta to collection2
    applyUpdate(collection2.doc, insertDelta);

    // collection2 should have the task
    expect(collection2.get('task-1')).toEqual({
      id: 'task-1',
      title: 'Task from collection 1',
      completed: false,
    });

    // Update on collection1
    const { delta: updateDelta } = collection1.update('task-1', {
      completed: true,
    });

    // Apply update delta
    applyUpdate(collection2.doc, updateDelta);

    expect(collection2.get('task-1')?.completed).toBe(true);

    // Delete on collection1
    const { delta: deleteDelta } = collection1.delete('task-1');

    // Apply delete delta
    applyUpdate(collection2.doc, deleteDelta);

    expect(collection2.get('task-1')).toBeNull();
  });

  it('getAll returns all items', () => {
    const collection = createTestCollection<Task>('tasks');

    collection.insert({ id: '1', title: 'Task 1', completed: false });
    collection.insert({ id: '2', title: 'Task 2', completed: true });
    collection.insert({ id: '3', title: 'Task 3', completed: false });

    const all = collection.getAll();
    expect(all).toHaveLength(3);
    expect(all.map((t) => t.id).sort()).toEqual(['1', '2', '3']);
  });

  it('handles multiple insert/update/delete cycles', () => {
    const collection = createTestCollection<Task>('tasks');

    // Insert
    collection.insert({ id: '1', title: 'First', completed: false });
    expect(collection.getAll()).toHaveLength(1);

    // Update
    collection.update('1', { title: 'First Updated' });
    expect(collection.get('1')?.title).toBe('First Updated');

    // Insert another
    collection.insert({ id: '2', title: 'Second', completed: false });
    expect(collection.getAll()).toHaveLength(2);

    // Delete first
    collection.delete('1');
    expect(collection.getAll()).toHaveLength(1);
    expect(collection.get('1')).toBeNull();
    expect(collection.get('2')).not.toBeNull();

    // Update remaining
    collection.update('2', { completed: true });
    expect(collection.get('2')?.completed).toBe(true);

    // Delete last
    collection.delete('2');
    expect(collection.getAll()).toHaveLength(0);
  });

  it('handles special characters in values', () => {
    const collection = createTestCollection<Task>('tasks');

    collection.insert({
      id: 'special',
      title: 'Task with "quotes" and <html> & symbols',
      completed: false,
    });

    const task = collection.get('special');
    expect(task?.title).toBe('Task with "quotes" and <html> & symbols');
  });

  it('handles unicode in values', () => {
    const collection = createTestCollection<Task>('tasks');

    collection.insert({
      id: 'unicode',
      title: '任务 🎉 مهمة',
      completed: false,
    });

    const task = collection.get('unicode');
    expect(task?.title).toBe('任务 🎉 مهمة');
  });
});
