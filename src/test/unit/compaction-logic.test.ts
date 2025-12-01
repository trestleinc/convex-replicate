/**
 * Compaction Logic Unit Tests
 *
 * Tests the core compaction logic in isolation without Convex/browser dependencies.
 * This mirrors what public.ts does during compaction to verify the bug.
 */

import { describe, test, expect } from 'vitest';
import * as Y from 'yjs';

describe('Compaction Logic', () => {
  /**
   * This test replicates the exact logic in public.ts:_compactCollectionInternal
   * to prove the bug exists.
   */
  describe('Current implementation (buggy)', () => {
    test('current compaction logic creates unusable snapshot bytes', () => {
      // Simulate deltas being stored in the database
      const sourceDoc = new Y.Doc({ guid: 'test-collection' });
      const sourceMap = sourceDoc.getMap('test-collection');

      // Collect deltas as they would be stored in Convex
      const deltas: { crdtBytes: ArrayBuffer; timestamp: number }[] = [];
      sourceDoc.on('updateV2', (update: Uint8Array) => {
        deltas.push({
          crdtBytes: update.slice().buffer,
          timestamp: Date.now(),
        });
      });

      // Create 110 documents (simulating 100+ deltas required for compaction)
      for (let i = 0; i < 110; i++) {
        sourceMap.set(
          `item-${i}`,
          new Y.Map([
            ['id', `item-${i}`],
            ['text', `Document ${i}`],
          ])
        );
      }

      expect(deltas.length).toBe(110);

      // === CURRENT BUGGY COMPACTION LOGIC (from public.ts:309-316) ===

      // Sort deltas by timestamp (as the real code does)
      const sorted = deltas.sort((a, b) => a.timestamp - b.timestamp);

      // Merge updates (this part is correct)
      const updates = sorted.map((d) => new Uint8Array(d.crdtBytes));
      const merged = Y.mergeUpdatesV2(updates);

      // Create temp doc and apply merged state (this is correct)
      const ydoc = new Y.Doc({ guid: 'test-collection' });
      Y.applyUpdateV2(ydoc, merged);

      // BUG: Create snapshot and encode it as snapshotBytes
      const snapshot = Y.snapshot(ydoc);
      const snapshotBytes = Y.encodeSnapshotV2(snapshot);

      // This is what gets stored in the snapshots table
      const storedSnapshotBytes = snapshotBytes.buffer as ArrayBuffer;

      // === VERIFY THE BUG: snapshotBytes cannot be used to reconstruct data ===

      const recoveryDoc = new Y.Doc({ guid: 'test-collection' });

      // This is what the client does when receiving a snapshot
      // (collection.ts:472)
      let recoveryFailed = false;
      try {
        Y.applyUpdateV2(recoveryDoc, new Uint8Array(storedSnapshotBytes));
      } catch (_e) {
        recoveryFailed = true;
        // Expected: RangeError because snapshot bytes are not valid updates
      }

      // If it didn't throw, check if data is actually there
      if (!recoveryFailed) {
        const recoveryMap = recoveryDoc.getMap('test-collection');
        // Data should be missing because snapshotBytes is a delete set, not state
        expect(recoveryMap.size).toBe(0);
      } else {
        // Recovery threw an error - this also proves the bug
        expect(recoveryFailed).toBe(true);
      }

      sourceDoc.destroy();
      ydoc.destroy();
      recoveryDoc.destroy();
    });

    test('snapshotContainsUpdate validation is misleading', () => {
      const doc = new Y.Doc();
      const map = doc.getMap('items');

      const updates: Uint8Array[] = [];
      doc.on('updateV2', (update: Uint8Array) => {
        updates.push(update);
      });

      map.set('a', new Y.Map([['id', 'a']]));
      map.set('b', new Y.Map([['id', 'b']]));

      const merged = Y.mergeUpdatesV2(updates);
      Y.applyUpdateV2(doc, merged);

      const snapshot = Y.snapshot(doc);

      // Current validation logic (public.ts:326)
      const isValid = updates.every((update) => Y.snapshotContainsUpdate(snapshot, update));

      // This returns true, but it doesn't mean the snapshot contains the data!
      // It means the snapshot's delete set knows about these updates
      expect(isValid).toBe(true);

      // BUT: the snapshot bytes cannot reconstruct the data
      const snapshotBytes = Y.encodeSnapshotV2(snapshot);
      const testDoc = new Y.Doc();

      let canApply = true;
      try {
        Y.applyUpdateV2(testDoc, snapshotBytes);
      } catch {
        canApply = false;
      }

      // Either it throws or results in empty doc
      if (canApply) {
        expect(testDoc.getMap('items').size).toBe(0);
      } else {
        expect(canApply).toBe(false);
      }

      doc.destroy();
      testDoc.destroy();
    });
  });

  describe('Correct implementation', () => {
    test('compaction should store merged update bytes, not snapshot bytes', () => {
      const sourceDoc = new Y.Doc({ guid: 'test-collection' });
      const sourceMap = sourceDoc.getMap('test-collection');

      // Collect deltas
      const deltas: { crdtBytes: ArrayBuffer; timestamp: number }[] = [];
      sourceDoc.on('updateV2', (update: Uint8Array) => {
        deltas.push({
          crdtBytes: update.slice().buffer,
          timestamp: Date.now(),
        });
      });

      // Create 110 documents
      for (let i = 0; i < 110; i++) {
        sourceMap.set(
          `item-${i}`,
          new Y.Map([
            ['id', `item-${i}`],
            ['text', `Document ${i}`],
          ])
        );
      }

      // === CORRECT COMPACTION LOGIC ===

      const sorted = deltas.sort((a, b) => a.timestamp - b.timestamp);
      const updates = sorted.map((d) => new Uint8Array(d.crdtBytes));

      // CORRECT: Store the merged update directly
      const compactedState = Y.mergeUpdatesV2(updates);
      const storedBytes = compactedState.buffer as ArrayBuffer;

      // === VERIFY: compactedState CAN reconstruct data ===

      const recoveryDoc = new Y.Doc({ guid: 'test-collection' });
      Y.applyUpdateV2(recoveryDoc, new Uint8Array(storedBytes));

      const recoveryMap = recoveryDoc.getMap('test-collection');

      // All 110 items should be present
      expect(recoveryMap.size).toBe(110);

      // Verify specific items
      const item0 = recoveryMap.get('item-0') as Y.Map<unknown>;
      expect(item0.get('id')).toBe('item-0');
      expect(item0.get('text')).toBe('Document 0');

      const item109 = recoveryMap.get('item-109') as Y.Map<unknown>;
      expect(item109.get('id')).toBe('item-109');
      expect(item109.get('text')).toBe('Document 109');

      sourceDoc.destroy();
      recoveryDoc.destroy();
    });

    test('proper validation should verify update can be applied', () => {
      const doc = new Y.Doc();
      const map = doc.getMap('items');

      const updates: Uint8Array[] = [];
      doc.on('updateV2', (update: Uint8Array) => {
        updates.push(update);
      });

      map.set('a', new Y.Map([['id', 'a']]));
      map.set('b', new Y.Map([['id', 'b']]));

      const compactedState = Y.mergeUpdatesV2(updates);

      // CORRECT validation: verify it can be applied to a fresh doc
      const testDoc = new Y.Doc();
      let isValid = true;

      try {
        Y.applyUpdateV2(testDoc, compactedState);
        // Additional check: verify expected data exists
        isValid = testDoc.getMap('items').size === 2;
      } catch {
        isValid = false;
      }

      expect(isValid).toBe(true);
      expect(testDoc.getMap('items').has('a')).toBe(true);
      expect(testDoc.getMap('items').has('b')).toBe(true);

      doc.destroy();
      testDoc.destroy();
    });

    test('alternative: use encodeStateAsUpdateV2 from applied doc', () => {
      const sourceDoc = new Y.Doc({ guid: 'test' });
      const sourceMap = sourceDoc.getMap('items');

      const updates: Uint8Array[] = [];
      sourceDoc.on('updateV2', (update: Uint8Array) => {
        updates.push(update);
      });

      sourceMap.set('a', new Y.Map([['id', 'a']]));
      sourceMap.set('b', new Y.Map([['id', 'b']]));

      // Method: Apply merged updates to doc, then encode full state
      const merged = Y.mergeUpdatesV2(updates);
      const tempDoc = new Y.Doc({ guid: 'test' });
      Y.applyUpdateV2(tempDoc, merged);

      // This gives us the full state that can be applied anywhere
      const fullState = Y.encodeStateAsUpdateV2(tempDoc);

      // Verify it works
      const recoveryDoc = new Y.Doc({ guid: 'test' });
      Y.applyUpdateV2(recoveryDoc, fullState);

      expect(recoveryDoc.getMap('items').size).toBe(2);

      sourceDoc.destroy();
      tempDoc.destroy();
      recoveryDoc.destroy();
    });
  });

  describe('Fix verification', () => {
    /**
     * This test shows the exact code change needed in public.ts
     */
    test('fixed _compactCollectionInternal logic', () => {
      // Simulate the fixed compaction function
      function fixedCompact(deltas: { crdtBytes: ArrayBuffer; timestamp: number }[]) {
        const sorted = deltas.sort((a, b) => a.timestamp - b.timestamp);
        const updates = sorted.map((d) => new Uint8Array(d.crdtBytes));

        // FIX: Don't create snapshot, just use merged updates directly
        const compactedState = Y.mergeUpdatesV2(updates);

        // FIX: Better validation - verify it can be applied
        const testDoc = new Y.Doc();
        try {
          Y.applyUpdateV2(testDoc, compactedState);
        } finally {
          testDoc.destroy();
        }

        // Return the merged update bytes (not snapshot bytes)
        return {
          snapshotBytes: compactedState.buffer as ArrayBuffer,
          latestCompactionTimestamp: sorted[sorted.length - 1].timestamp,
        };
      }

      // Create test data
      const sourceDoc = new Y.Doc({ guid: 'test' });
      const sourceMap = sourceDoc.getMap('test');

      const deltas: { crdtBytes: ArrayBuffer; timestamp: number }[] = [];
      sourceDoc.on('updateV2', (update: Uint8Array) => {
        deltas.push({
          crdtBytes: update.slice().buffer,
          timestamp: Date.now(),
        });
      });

      for (let i = 0; i < 110; i++) {
        sourceMap.set(`item-${i}`, new Y.Map([['id', `item-${i}`]]));
      }

      // Run fixed compaction
      const result = fixedCompact(deltas);

      // Verify recovery works
      const recoveryDoc = new Y.Doc({ guid: 'test' });
      Y.applyUpdateV2(recoveryDoc, new Uint8Array(result.snapshotBytes));

      expect(recoveryDoc.getMap('test').size).toBe(110);

      sourceDoc.destroy();
      recoveryDoc.destroy();
    });
  });
});
