/**
 * Undo/Redo Unit Tests
 *
 * Tests the Y.UndoManager integration for undo/redo functionality.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

describe('Y.UndoManager', () => {
  let doc: Y.Doc;
  let ymap: Y.Map<Y.Map<unknown>>;
  let undoManager: Y.UndoManager;

  beforeEach(() => {
    doc = new Y.Doc({ guid: 'test-collection' });
    ymap = doc.getMap('test-collection');
    undoManager = new Y.UndoManager(ymap, {
      captureTimeout: 0, // Immediate capture for tests
    });
  });

  afterEach(() => {
    undoManager.destroy();
    doc.destroy();
  });

  describe('basic undo/redo', () => {
    test('can undo insert', () => {
      // Insert an item
      const item = new Y.Map<unknown>();
      item.set('id', 'item-1');
      item.set('text', 'Hello');
      ymap.set('item-1', item);

      expect(ymap.size).toBe(1);
      expect(undoManager.canUndo()).toBe(true);
      expect(undoManager.canRedo()).toBe(false);

      // Undo the insert
      undoManager.undo();

      expect(ymap.size).toBe(0);
      expect(undoManager.canUndo()).toBe(false);
      expect(undoManager.canRedo()).toBe(true);
    });

    test('can redo after undo', () => {
      // Insert an item
      const item = new Y.Map<unknown>();
      item.set('id', 'item-1');
      item.set('text', 'Hello');
      ymap.set('item-1', item);

      // Undo
      undoManager.undo();
      expect(ymap.size).toBe(0);

      // Redo
      undoManager.redo();
      expect(ymap.size).toBe(1);

      const restored = ymap.get('item-1');
      expect(restored).toBeInstanceOf(Y.Map);
      expect((restored as Y.Map<unknown>).get('text')).toBe('Hello');
    });

    test('can undo update', () => {
      // Insert an item
      const item = new Y.Map<unknown>();
      item.set('id', 'item-1');
      item.set('text', 'Hello');
      ymap.set('item-1', item);

      // Clear undo stack to start fresh
      undoManager.clear();

      // Update the item
      item.set('text', 'World');

      expect((ymap.get('item-1') as Y.Map<unknown>).get('text')).toBe('World');
      expect(undoManager.canUndo()).toBe(true);

      // Undo the update
      undoManager.undo();

      expect((ymap.get('item-1') as Y.Map<unknown>).get('text')).toBe('Hello');
    });

    test('can undo delete', () => {
      // Insert an item
      const item = new Y.Map<unknown>();
      item.set('id', 'item-1');
      item.set('text', 'Hello');
      ymap.set('item-1', item);

      // Clear undo stack
      undoManager.clear();

      // Delete the item
      ymap.delete('item-1');

      expect(ymap.size).toBe(0);
      expect(undoManager.canUndo()).toBe(true);

      // Undo the delete
      undoManager.undo();

      expect(ymap.size).toBe(1);
      const restored = ymap.get('item-1');
      expect(restored).toBeInstanceOf(Y.Map);
      expect((restored as Y.Map<unknown>).get('text')).toBe('Hello');
    });
  });

  describe('capture timeout behavior', () => {
    test('captures multiple changes as one undo step', async () => {
      // Use 100ms capture timeout
      const slowUndoManager = new Y.UndoManager(ymap, {
        captureTimeout: 100,
      });

      // Insert and immediately update
      const item = new Y.Map<unknown>();
      item.set('id', 'item-1');
      item.set('text', 'Hello');
      ymap.set('item-1', item);

      item.set('text', 'World');

      // Should be captured as one undo step
      slowUndoManager.undo();
      expect(ymap.size).toBe(0);
      expect(slowUndoManager.canUndo()).toBe(false);

      slowUndoManager.destroy();
    });

    test('stopCapturing forces new undo stack item', () => {
      // Insert an item
      const item = new Y.Map<unknown>();
      item.set('id', 'item-1');
      item.set('text', 'Hello');
      ymap.set('item-1', item);

      // Stop capturing to force new stack item
      undoManager.stopCapturing();

      // Update - should be a separate undo step
      item.set('text', 'World');

      expect((ymap.get('item-1') as Y.Map<unknown>).get('text')).toBe('World');

      // Undo should only undo the update
      undoManager.undo();
      expect((ymap.get('item-1') as Y.Map<unknown>).get('text')).toBe('Hello');
      expect(ymap.size).toBe(1);
    });
  });

  describe('clear history', () => {
    test('clears undo and redo stacks', () => {
      // Insert an item
      const item = new Y.Map<unknown>();
      item.set('id', 'item-1');
      item.set('text', 'Hello');
      ymap.set('item-1', item);

      expect(undoManager.canUndo()).toBe(true);

      // Clear
      undoManager.clear();

      expect(undoManager.canUndo()).toBe(false);
      expect(undoManager.canRedo()).toBe(false);
      // Data should still be there
      expect(ymap.size).toBe(1);
    });
  });

  describe('tracked origins', () => {
    test('only tracks specified origins', () => {
      const TRACKED_ORIGIN = 'user-action';
      const UNTRACKED_ORIGIN = 'sync';

      const trackedUndoManager = new Y.UndoManager(ymap, {
        captureTimeout: 0,
        trackedOrigins: new Set([TRACKED_ORIGIN]),
      });

      // Insert with untracked origin - should NOT be tracked
      doc.transact(() => {
        const item1 = new Y.Map<unknown>();
        item1.set('id', 'item-1');
        item1.set('text', 'Synced');
        ymap.set('item-1', item1);
      }, UNTRACKED_ORIGIN);

      expect(trackedUndoManager.canUndo()).toBe(false);

      // Insert with tracked origin - should be tracked
      doc.transact(() => {
        const item2 = new Y.Map<unknown>();
        item2.set('id', 'item-2');
        item2.set('text', 'User');
        ymap.set('item-2', item2);
      }, TRACKED_ORIGIN);

      expect(trackedUndoManager.canUndo()).toBe(true);

      // Undo should only undo the tracked change
      trackedUndoManager.undo();
      expect(ymap.size).toBe(1);
      expect(ymap.has('item-1')).toBe(true);
      expect(ymap.has('item-2')).toBe(false);

      trackedUndoManager.destroy();
    });
  });

  describe('multiple undo/redo steps', () => {
    test('handles multiple undo steps', () => {
      // Insert item 1
      const item1 = new Y.Map<unknown>();
      item1.set('id', 'item-1');
      item1.set('text', 'First');
      ymap.set('item-1', item1);
      undoManager.stopCapturing();

      // Insert item 2
      const item2 = new Y.Map<unknown>();
      item2.set('id', 'item-2');
      item2.set('text', 'Second');
      ymap.set('item-2', item2);
      undoManager.stopCapturing();

      // Insert item 3
      const item3 = new Y.Map<unknown>();
      item3.set('id', 'item-3');
      item3.set('text', 'Third');
      ymap.set('item-3', item3);

      expect(ymap.size).toBe(3);

      // Undo all
      undoManager.undo(); // Remove item 3
      expect(ymap.size).toBe(2);

      undoManager.undo(); // Remove item 2
      expect(ymap.size).toBe(1);

      undoManager.undo(); // Remove item 1
      expect(ymap.size).toBe(0);

      // Redo all
      undoManager.redo(); // Restore item 1
      expect(ymap.size).toBe(1);

      undoManager.redo(); // Restore item 2
      expect(ymap.size).toBe(2);

      undoManager.redo(); // Restore item 3
      expect(ymap.size).toBe(3);
    });

    test('new change clears redo stack', () => {
      // Insert item 1
      const item1 = new Y.Map<unknown>();
      item1.set('id', 'item-1');
      item1.set('text', 'First');
      ymap.set('item-1', item1);
      undoManager.stopCapturing();

      // Insert item 2
      const item2 = new Y.Map<unknown>();
      item2.set('id', 'item-2');
      item2.set('text', 'Second');
      ymap.set('item-2', item2);

      // Undo item 2
      undoManager.undo();
      expect(ymap.size).toBe(1);
      expect(undoManager.canRedo()).toBe(true);

      // Make a new change - should clear redo stack
      const item3 = new Y.Map<unknown>();
      item3.set('id', 'item-3');
      item3.set('text', 'Third');
      ymap.set('item-3', item3);

      expect(undoManager.canRedo()).toBe(false);
    });
  });
});
