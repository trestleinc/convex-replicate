/**
 * Yjs API Behavior Tests
 *
 * These tests verify the correct behavior of Yjs snapshot vs update APIs.
 * The goal is to prove/disprove the hypothesis that our compaction code
 * is using the wrong Yjs APIs.
 *
 * Key distinction:
 * - Y.snapshot() + Y.encodeSnapshotV2() = Creates a "delete set" for version comparison
 * - Y.encodeStateAsUpdateV2() / Y.mergeUpdatesV2() = Creates actual document state
 */

import { describe, test, expect } from 'vitest';
import * as Y from 'yjs';

describe('Yjs Snapshot vs Update APIs', () => {
  describe('Y.encodeSnapshotV2 behavior', () => {
    test('Y.encodeSnapshotV2 does NOT create a state that can be applied to reconstruct data', () => {
      // Create a document with some data
      const doc1 = new Y.Doc();
      const map = doc1.getMap('items');
      map.set(
        'a',
        new Y.Map([
          ['id', 'a'],
          ['text', 'hello'],
        ])
      );

      // Get the actual content to verify it exists
      const itemA = map.get('a') as Y.Map<unknown>;
      expect(itemA.get('id')).toBe('a');
      expect(itemA.get('text')).toBe('hello');

      // Current compaction approach: create snapshot and encode it
      const snapshot = Y.snapshot(doc1);
      const snapshotBytes = Y.encodeSnapshotV2(snapshot);

      // Try to reconstruct from snapshot bytes
      const doc2 = new Y.Doc();

      // This should NOT throw, but it also should NOT create the data
      // because snapshotBytes is a delete set, not document state
      try {
        Y.applyUpdateV2(doc2, snapshotBytes);
      } catch (e) {
        // If it throws, that also proves the point - snapshot bytes aren't updates
        console.log('applyUpdateV2 threw error with snapshot bytes:', e);
      }

      // CRITICAL ASSERTION: doc2 should be EMPTY because snapshotBytes
      // is a delete set (for version comparison), not document state
      const doc2Map = doc2.getMap('items');
      expect(doc2Map.size).toBe(0);

      doc1.destroy();
      doc2.destroy();
    });

    test('Y.snapshot is meant for version comparison, not state storage', () => {
      // Note: createDocFromSnapshot requires gc: false
      const doc = new Y.Doc({ gc: false });
      const map = doc.getMap('items');

      // Add item A
      map.set('a', new Y.Map([['id', 'a']]));
      const snapshot1 = Y.snapshot(doc);

      // Add item B
      map.set('b', new Y.Map([['id', 'b']]));
      const _snapshot2 = Y.snapshot(doc);

      // Snapshots are for creating historical views
      const historicalDoc = Y.createDocFromSnapshot(doc, snapshot1);
      const historicalMap = historicalDoc.getMap('items');

      // Historical doc should only have item A (state at snapshot1)
      expect(historicalMap.size).toBe(1);
      expect(historicalMap.has('a')).toBe(true);
      expect(historicalMap.has('b')).toBe(false);

      // Current doc should have both
      expect(map.size).toBe(2);

      doc.destroy();
      historicalDoc.destroy();
    });
  });

  describe('Y.encodeStateAsUpdateV2 behavior', () => {
    test('Y.encodeStateAsUpdateV2 creates state that CAN be applied to reconstruct data', () => {
      // Create a document with some data
      const doc1 = new Y.Doc();
      const map = doc1.getMap('items');
      map.set(
        'a',
        new Y.Map([
          ['id', 'a'],
          ['text', 'hello'],
        ])
      );
      map.set(
        'b',
        new Y.Map([
          ['id', 'b'],
          ['text', 'world'],
        ])
      );

      // CORRECT approach: encode state as update
      const stateUpdate = Y.encodeStateAsUpdateV2(doc1);

      // Apply to new document
      const doc2 = new Y.Doc();
      Y.applyUpdateV2(doc2, stateUpdate);

      // doc2 should have the exact same data
      const doc2Map = doc2.getMap('items');
      expect(doc2Map.size).toBe(2);

      const itemA = doc2Map.get('a') as Y.Map<unknown>;
      expect(itemA.get('id')).toBe('a');
      expect(itemA.get('text')).toBe('hello');

      const itemB = doc2Map.get('b') as Y.Map<unknown>;
      expect(itemB.get('id')).toBe('b');
      expect(itemB.get('text')).toBe('world');

      doc1.destroy();
      doc2.destroy();
    });
  });

  describe('Y.mergeUpdatesV2 behavior', () => {
    test('Y.mergeUpdatesV2 combines multiple updates into a single state update', () => {
      const doc1 = new Y.Doc();
      const map = doc1.getMap('items');

      // Collect individual updates
      const updates: Uint8Array[] = [];

      doc1.on('updateV2', (update: Uint8Array) => {
        updates.push(update);
      });

      // Make multiple changes
      map.set('a', new Y.Map([['id', 'a']]));
      map.set('b', new Y.Map([['id', 'b']]));
      map.set('c', new Y.Map([['id', 'c']]));

      // We should have collected 3 updates
      expect(updates.length).toBe(3);

      // Merge them
      const merged = Y.mergeUpdatesV2(updates);

      // Apply merged update to new document
      const doc2 = new Y.Doc();
      Y.applyUpdateV2(doc2, merged);

      // doc2 should have all 3 items
      const doc2Map = doc2.getMap('items');
      expect(doc2Map.size).toBe(3);
      expect(doc2Map.has('a')).toBe(true);
      expect(doc2Map.has('b')).toBe(true);
      expect(doc2Map.has('c')).toBe(true);

      doc1.destroy();
      doc2.destroy();
    });

    test('merged update is smaller than sum of individual updates', () => {
      const doc = new Y.Doc();
      const map = doc.getMap('items');

      const updates: Uint8Array[] = [];
      doc.on('updateV2', (update: Uint8Array) => {
        updates.push(update);
      });

      // Create and update the same item multiple times
      map.set(
        'a',
        new Y.Map([
          ['id', 'a'],
          ['count', 0],
        ])
      );
      for (let i = 1; i <= 10; i++) {
        const item = map.get('a') as Y.Map<unknown>;
        item.set('count', i);
      }

      const totalSize = updates.reduce((sum, u) => sum + u.byteLength, 0);
      const merged = Y.mergeUpdatesV2(updates);

      // Merged should be smaller (or equal in edge cases)
      expect(merged.byteLength).toBeLessThanOrEqual(totalSize);

      // But merged should still reconstruct the final state
      const doc2 = new Y.Doc();
      Y.applyUpdateV2(doc2, merged);
      const item = doc2.getMap('items').get('a') as Y.Map<unknown>;
      expect(item.get('count')).toBe(10);

      doc.destroy();
      doc2.destroy();
    });
  });

  describe('Y.snapshotContainsUpdate behavior', () => {
    test('snapshotContainsUpdate checks if update would be affected by snapshot, not if data is included', () => {
      const doc = new Y.Doc();
      const map = doc.getMap('items');

      // Create item and snapshot
      map.set('a', new Y.Map([['id', 'a']]));
      const snapshot = Y.snapshot(doc);

      // Get the update for item 'a'
      const updateA = Y.encodeStateAsUpdateV2(doc);

      // snapshotContainsUpdate should return true because the snapshot
      // was taken AFTER the update was applied
      const contains = Y.snapshotContainsUpdate(snapshot, updateA);
      expect(contains).toBe(true);

      // Now add more data AFTER the snapshot
      map.set('b', new Y.Map([['id', 'b']]));

      // Get full state including 'b'
      Y.encodeStateAsUpdateV2(doc);

      // This check is about whether the update is "known" to the snapshot,
      // NOT whether the snapshot contains the actual data
      // The snapshot doesn't know about 'b', so this might return false
      // (depends on how the update was created)

      doc.destroy();
    });
  });

  describe('What compaction SHOULD do', () => {
    test('correct compaction: merge updates, then store merged result', () => {
      const doc = new Y.Doc({ guid: 'test-collection' });
      const map = doc.getMap('test-collection');

      // Simulate 100+ deltas being created
      const deltas: Uint8Array[] = [];
      doc.on('updateV2', (update: Uint8Array) => {
        deltas.push(update);
      });

      // Create many documents
      for (let i = 0; i < 110; i++) {
        map.set(
          `item-${i}`,
          new Y.Map([
            ['id', `item-${i}`],
            ['text', `Document ${i}`],
          ])
        );
      }

      expect(deltas.length).toBe(110);

      // CORRECT compaction: merge all deltas
      const compactedState = Y.mergeUpdatesV2(deltas);

      // Verify compacted state can reconstruct all documents
      const recoveryDoc = new Y.Doc({ guid: 'test-collection' });
      Y.applyUpdateV2(recoveryDoc, compactedState);

      const recoveryMap = recoveryDoc.getMap('test-collection');
      expect(recoveryMap.size).toBe(110);

      // Verify specific documents
      const item0 = recoveryMap.get('item-0') as Y.Map<unknown>;
      expect(item0.get('id')).toBe('item-0');
      expect(item0.get('text')).toBe('Document 0');

      const item109 = recoveryMap.get('item-109') as Y.Map<unknown>;
      expect(item109.get('id')).toBe('item-109');
      expect(item109.get('text')).toBe('Document 109');

      doc.destroy();
      recoveryDoc.destroy();
    });

    test('WRONG compaction: using Y.snapshot + Y.encodeSnapshotV2 loses data', () => {
      const doc = new Y.Doc({ guid: 'test-collection' });
      const map = doc.getMap('test-collection');

      // Create documents
      for (let i = 0; i < 5; i++) {
        map.set(
          `item-${i}`,
          new Y.Map([
            ['id', `item-${i}`],
            ['text', `Document ${i}`],
          ])
        );
      }

      // WRONG: Create snapshot and encode it
      const snapshot = Y.snapshot(doc);
      const snapshotBytes = Y.encodeSnapshotV2(snapshot);

      // Try to recover from snapshot bytes
      const recoveryDoc = new Y.Doc({ guid: 'test-collection' });

      // This either throws or creates an empty/corrupted doc
      let recovered = false;
      try {
        Y.applyUpdateV2(recoveryDoc, snapshotBytes);
        recovered = true;
      } catch (_e) {
        // Expected - snapshot bytes aren't valid updates
        recovered = false;
      }

      const recoveryMap = recoveryDoc.getMap('test-collection');

      if (recovered) {
        // Even if it didn't throw, the data is lost
        expect(recoveryMap.size).toBe(0);
      }

      doc.destroy();
      recoveryDoc.destroy();
    });
  });

  describe('Alternative: encodeStateAsUpdate from doc with merged updates', () => {
    test('can merge updates, apply to doc, then encode full state', () => {
      const sourceDoc = new Y.Doc();
      const sourceMap = sourceDoc.getMap('items');

      // Collect updates
      const updates: Uint8Array[] = [];
      sourceDoc.on('updateV2', (update: Uint8Array) => {
        updates.push(update);
      });

      // Create data
      sourceMap.set('a', new Y.Map([['id', 'a']]));
      sourceMap.set('b', new Y.Map([['id', 'b']]));

      // Method 1: Direct merge
      const merged = Y.mergeUpdatesV2(updates);

      // Method 2: Apply merged to new doc, then encode full state
      const tempDoc = new Y.Doc();
      Y.applyUpdateV2(tempDoc, merged);
      const fullState = Y.encodeStateAsUpdateV2(tempDoc);

      // Both should work for recovery
      const doc1 = new Y.Doc();
      Y.applyUpdateV2(doc1, merged);
      expect(doc1.getMap('items').size).toBe(2);

      const doc2 = new Y.Doc();
      Y.applyUpdateV2(doc2, fullState);
      expect(doc2.getMap('items').size).toBe(2);

      sourceDoc.destroy();
      tempDoc.destroy();
      doc1.destroy();
      doc2.destroy();
    });
  });
});
