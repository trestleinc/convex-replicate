/**
 * History Utilities Unit Tests
 *
 * Tests the client-side history diffing and extraction utilities.
 */

import { describe, test, expect } from 'vitest';
import * as Y from 'yjs';
import { diff, fields, materialize, extract } from '$/client/history.js';
import { history } from '$/client/index.js';

describe('History Utilities', () => {
  describe('diff', () => {
    test('detects added documents', () => {
      const collection = 'test-collection';

      // State A: has item-1
      const docA = new Y.Doc({ guid: collection });
      const mapA = docA.getMap(collection);
      mapA.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
        ])
      );
      const stateA = Y.encodeStateAsUpdateV2(docA);

      // State B: has item-1 and item-2
      const docB = new Y.Doc({ guid: collection });
      const mapB = docB.getMap(collection);
      mapB.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
        ])
      );
      mapB.set(
        'item-2',
        new Y.Map([
          ['id', 'item-2'],
          ['text', 'World'],
        ])
      );
      const stateB = Y.encodeStateAsUpdateV2(docB);

      const result = diff(stateA, stateB, collection);

      expect(result.added).toEqual(['item-2']);
      expect(result.removed).toEqual([]);
      expect(result.modified).toEqual([]);

      docA.destroy();
      docB.destroy();
    });

    test('detects removed documents', () => {
      const collection = 'test-collection';

      // State A: has item-1 and item-2
      const docA = new Y.Doc({ guid: collection });
      const mapA = docA.getMap(collection);
      mapA.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
        ])
      );
      mapA.set(
        'item-2',
        new Y.Map([
          ['id', 'item-2'],
          ['text', 'World'],
        ])
      );
      const stateA = Y.encodeStateAsUpdateV2(docA);

      // State B: only has item-1
      const docB = new Y.Doc({ guid: collection });
      const mapB = docB.getMap(collection);
      mapB.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
        ])
      );
      const stateB = Y.encodeStateAsUpdateV2(docB);

      const result = diff(stateA, stateB, collection);

      expect(result.added).toEqual([]);
      expect(result.removed).toEqual(['item-2']);
      expect(result.modified).toEqual([]);

      docA.destroy();
      docB.destroy();
    });

    test('detects modified documents', () => {
      const collection = 'test-collection';

      // State A: item-1 with text "Hello"
      const docA = new Y.Doc({ guid: collection });
      const mapA = docA.getMap(collection);
      mapA.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
        ])
      );
      const stateA = Y.encodeStateAsUpdateV2(docA);

      // State B: item-1 with text "Hello World"
      const docB = new Y.Doc({ guid: collection });
      const mapB = docB.getMap(collection);
      mapB.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello World'],
        ])
      );
      const stateB = Y.encodeStateAsUpdateV2(docB);

      const result = diff(stateA, stateB, collection);

      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.modified).toEqual(['item-1']);

      docA.destroy();
      docB.destroy();
    });

    test('handles complex diff with all changes', () => {
      const collection = 'test-collection';

      // State A: has item-1 (to be removed), item-2 (to be modified)
      const docA = new Y.Doc({ guid: collection });
      const mapA = docA.getMap(collection);
      mapA.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Remove me'],
        ])
      );
      mapA.set(
        'item-2',
        new Y.Map([
          ['id', 'item-2'],
          ['text', 'Original'],
        ])
      );
      const stateA = Y.encodeStateAsUpdateV2(docA);

      // State B: item-2 modified, item-3 added
      const docB = new Y.Doc({ guid: collection });
      const mapB = docB.getMap(collection);
      mapB.set(
        'item-2',
        new Y.Map([
          ['id', 'item-2'],
          ['text', 'Modified'],
        ])
      );
      mapB.set(
        'item-3',
        new Y.Map([
          ['id', 'item-3'],
          ['text', 'New item'],
        ])
      );
      const stateB = Y.encodeStateAsUpdateV2(docB);

      const result = diff(stateA, stateB, collection);

      expect(result.added).toEqual(['item-3']);
      expect(result.removed).toEqual(['item-1']);
      expect(result.modified).toEqual(['item-2']);

      docA.destroy();
      docB.destroy();
    });

    test('handles empty states', () => {
      const collection = 'test-collection';

      const docA = new Y.Doc({ guid: collection });
      const stateA = Y.encodeStateAsUpdateV2(docA);

      const docB = new Y.Doc({ guid: collection });
      const stateB = Y.encodeStateAsUpdateV2(docB);

      const result = diff(stateA, stateB, collection);

      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.modified).toEqual([]);

      docA.destroy();
      docB.destroy();
    });
  });

  describe('fields', () => {
    test('detects added fields', () => {
      const collection = 'test-collection';

      // State A: item-1 with text field
      const docA = new Y.Doc({ guid: collection });
      const mapA = docA.getMap(collection);
      mapA.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
        ])
      );
      const stateA = Y.encodeStateAsUpdateV2(docA);

      // State B: item-1 with text and priority fields
      const docB = new Y.Doc({ guid: collection });
      const mapB = docB.getMap(collection);
      mapB.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
          ['priority', 'high'],
        ])
      );
      const stateB = Y.encodeStateAsUpdateV2(docB);

      const result = fields(stateA, stateB, collection, 'item-1');

      expect(result).not.toBeNull();
      expect(result!.added).toEqual(['priority']);
      expect(result!.removed).toEqual([]);
      expect(result!.modified).toEqual([]);

      docA.destroy();
      docB.destroy();
    });

    test('detects removed fields', () => {
      const collection = 'test-collection';

      // State A: item-1 with text and priority
      const docA = new Y.Doc({ guid: collection });
      const mapA = docA.getMap(collection);
      mapA.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
          ['priority', 'high'],
        ])
      );
      const stateA = Y.encodeStateAsUpdateV2(docA);

      // State B: item-1 with only text
      const docB = new Y.Doc({ guid: collection });
      const mapB = docB.getMap(collection);
      mapB.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
        ])
      );
      const stateB = Y.encodeStateAsUpdateV2(docB);

      const result = fields(stateA, stateB, collection, 'item-1');

      expect(result).not.toBeNull();
      expect(result!.added).toEqual([]);
      expect(result!.removed).toEqual(['priority']);
      expect(result!.modified).toEqual([]);

      docA.destroy();
      docB.destroy();
    });

    test('detects modified fields', () => {
      const collection = 'test-collection';

      // State A: item-1 with text "Hello"
      const docA = new Y.Doc({ guid: collection });
      const mapA = docA.getMap(collection);
      mapA.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
        ])
      );
      const stateA = Y.encodeStateAsUpdateV2(docA);

      // State B: item-1 with text "World"
      const docB = new Y.Doc({ guid: collection });
      const mapB = docB.getMap(collection);
      mapB.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'World'],
        ])
      );
      const stateB = Y.encodeStateAsUpdateV2(docB);

      const result = fields(stateA, stateB, collection, 'item-1');

      expect(result).not.toBeNull();
      expect(result!.added).toEqual([]);
      expect(result!.removed).toEqual([]);
      expect(result!.modified).toHaveLength(1);
      expect(result!.modified[0].field).toBe('text');
      expect(result!.modified[0].oldValue).toBe('Hello');
      expect(result!.modified[0].newValue).toBe('World');

      docA.destroy();
      docB.destroy();
    });

    test('returns null for non-existent document', () => {
      const collection = 'test-collection';

      const docA = new Y.Doc({ guid: collection });
      const stateA = Y.encodeStateAsUpdateV2(docA);

      const docB = new Y.Doc({ guid: collection });
      const stateB = Y.encodeStateAsUpdateV2(docB);

      const result = fields(stateA, stateB, collection, 'non-existent');

      expect(result).toBeNull();

      docA.destroy();
      docB.destroy();
    });
  });

  describe('materialize', () => {
    test('extracts all documents from state', () => {
      const collection = 'test-collection';

      const doc = new Y.Doc({ guid: collection });
      const map = doc.getMap(collection);
      map.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
        ])
      );
      map.set(
        'item-2',
        new Y.Map([
          ['id', 'item-2'],
          ['text', 'World'],
        ])
      );
      const state = Y.encodeStateAsUpdateV2(doc);

      interface TestDoc {
        id: string;
        text: string;
      }
      const documents = materialize<TestDoc>(state, collection);

      expect(documents).toHaveLength(2);
      expect(documents.find((d) => d.id === 'item-1')?.text).toBe('Hello');
      expect(documents.find((d) => d.id === 'item-2')?.text).toBe('World');

      doc.destroy();
    });

    test('returns empty array for empty state', () => {
      const collection = 'test-collection';

      const doc = new Y.Doc({ guid: collection });
      const state = Y.encodeStateAsUpdateV2(doc);

      const documents = materialize(state, collection);

      expect(documents).toEqual([]);

      doc.destroy();
    });
  });

  describe('extract', () => {
    test('extracts single document by ID', () => {
      const collection = 'test-collection';

      const doc = new Y.Doc({ guid: collection });
      const map = doc.getMap(collection);
      map.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
          ['priority', 'high'],
        ])
      );
      map.set(
        'item-2',
        new Y.Map([
          ['id', 'item-2'],
          ['text', 'World'],
        ])
      );
      const state = Y.encodeStateAsUpdateV2(doc);

      interface TestDoc {
        id: string;
        text: string;
        priority?: string;
      }
      const document = extract<TestDoc>(state, collection, 'item-1');

      expect(document).not.toBeNull();
      expect(document!.id).toBe('item-1');
      expect(document!.text).toBe('Hello');
      expect(document!.priority).toBe('high');

      doc.destroy();
    });

    test('returns null for non-existent document', () => {
      const collection = 'test-collection';

      const doc = new Y.Doc({ guid: collection });
      const map = doc.getMap(collection);
      map.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
        ])
      );
      const state = Y.encodeStateAsUpdateV2(doc);

      const document = extract(state, collection, 'non-existent');

      expect(document).toBeNull();

      doc.destroy();
    });
  });

  describe('History workflow', () => {
    test('simulates complete history workflow', () => {
      const collection = 'tasks';

      // Initial state: 2 tasks
      const doc1 = new Y.Doc({ guid: collection });
      const map1 = doc1.getMap(collection);
      map1.set(
        'task-1',
        new Y.Map([
          ['id', 'task-1'],
          ['text', 'Buy groceries'],
          ['done', false],
        ])
      );
      map1.set(
        'task-2',
        new Y.Map([
          ['id', 'task-2'],
          ['text', 'Walk dog'],
          ['done', false],
        ])
      );
      const version1 = Y.encodeStateAsUpdateV2(doc1);

      // After changes: task-1 marked done, task-2 modified, task-3 added
      const doc2 = new Y.Doc({ guid: collection });
      const map2 = doc2.getMap(collection);
      map2.set(
        'task-1',
        new Y.Map([
          ['id', 'task-1'],
          ['text', 'Buy groceries'],
          ['done', true],
        ])
      );
      map2.set(
        'task-2',
        new Y.Map([
          ['id', 'task-2'],
          ['text', 'Walk the dog'],
          ['done', false],
        ])
      );
      map2.set(
        'task-3',
        new Y.Map([
          ['id', 'task-3'],
          ['text', 'Clean room'],
          ['done', false],
        ])
      );
      const version2 = Y.encodeStateAsUpdateV2(doc2);

      // 1. Compare versions at collection level
      const collectionDiff = diff(version1, version2, collection);
      expect(collectionDiff.added).toEqual(['task-3']);
      expect(collectionDiff.removed).toEqual([]);
      expect(collectionDiff.modified).toContain('task-1');
      expect(collectionDiff.modified).toContain('task-2');

      // 2. Get detailed diff for task-1
      const task1Fields = fields(version1, version2, collection, 'task-1');
      expect(task1Fields).not.toBeNull();
      expect(task1Fields!.modified).toContainEqual({
        field: 'done',
        oldValue: false,
        newValue: true,
      });

      // 3. Get detailed diff for task-2
      const task2Fields = fields(version1, version2, collection, 'task-2');
      expect(task2Fields).not.toBeNull();
      expect(task2Fields!.modified).toContainEqual({
        field: 'text',
        oldValue: 'Walk dog',
        newValue: 'Walk the dog',
      });

      // 4. View all documents in old version
      interface Task {
        id: string;
        text: string;
        done: boolean;
      }
      const oldTasks = materialize<Task>(version1, collection);
      expect(oldTasks).toHaveLength(2);

      // 5. View specific document in old version
      const oldTask1 = extract<Task>(version1, collection, 'task-1');
      expect(oldTask1?.done).toBe(false);

      doc1.destroy();
      doc2.destroy();
    });
  });

  describe('namespace export', () => {
    test('history namespace exports all functions', () => {
      // Verify the namespace export structure
      expect(typeof history.diff).toBe('function');
      expect(typeof history.fields).toBe('function');
      expect(typeof history.materialize).toBe('function');
      expect(typeof history.extract).toBe('function');
    });

    test('history.diff works same as direct import', () => {
      const collection = 'test-collection';

      const docA = new Y.Doc({ guid: collection });
      const stateA = Y.encodeStateAsUpdateV2(docA);

      const docB = new Y.Doc({ guid: collection });
      const mapB = docB.getMap(collection);
      mapB.set(
        'item-1',
        new Y.Map([
          ['id', 'item-1'],
          ['text', 'Hello'],
        ])
      );
      const stateB = Y.encodeStateAsUpdateV2(docB);

      // Compare direct import vs namespace
      const directResult = diff(stateA, stateB, collection);
      const namespaceResult = history.diff(stateA, stateB, collection);

      expect(namespaceResult).toEqual(directResult);

      docA.destroy();
      docB.destroy();
    });
  });
});
