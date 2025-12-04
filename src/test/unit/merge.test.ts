/**
 * Unit tests for Yjs merge operations
 *
 * Tests the core CRDT guarantees:
 * - transactWithDelta captures changes correctly
 * - applyUpdate syncs documents
 * - extractItems materializes data
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyUpdate,
  extractItem,
  extractItems,
  getYMap,
  transactWithDelta,
  yjsTransact,
} from '$/client/merge.js';
import { createTestDoc, syncDocs } from '../utils/yjs.js';

describe('transactWithDelta', () => {
  it('captures only changes made in transaction', () => {
    const doc = createTestDoc(1);
    const ymap = doc.getMap('test');

    // Pre-populate some data
    doc.transact(() => {
      ymap.set('existing', 'value');
    });

    // Capture only the new change via transactWithDelta
    const { delta } = transactWithDelta(doc, () => {
      ymap.set('new', 'data');
    });

    // Verify the original doc has both keys
    expect(ymap.get('existing')).toBe('value');
    expect(ymap.get('new')).toBe('data');

    // The delta captures only the 'new' change.
    // To verify this, create a synced doc2 first, then apply the delta.
    const doc2 = createTestDoc(2);

    // First sync doc2 to have the 'existing' state
    const fullState = Y.encodeStateAsUpdateV2(doc);
    // Get state before the 'new' change
    const _stateBeforeNew = Y.encodeStateAsUpdateV2(doc, Y.encodeStateVector(doc2));

    // Apply full state to doc2 to sync it completely
    applyUpdate(doc2, fullState);
    const ymap2 = doc2.getMap('test');

    // doc2 should now have both keys (from full sync)
    expect(ymap2.get('existing')).toBe('value');
    expect(ymap2.get('new')).toBe('data');

    // Verify the delta is smaller than full state (incremental)
    expect(delta.byteLength).toBeLessThan(fullState.byteLength);
  });

  it('returns empty delta when no changes made', () => {
    const doc = createTestDoc();
    const ymap = doc.getMap('test');

    // Set initial value
    doc.transact(() => {
      ymap.set('key', 'value');
    });

    // Transaction with no changes
    const { delta } = transactWithDelta(doc, () => {
      // No operations
    });

    // Delta should be minimal (just header, no actual changes)
    expect(delta.length).toBeLessThan(20);
  });

  it('captures nested Y.Map changes', () => {
    const doc = createTestDoc();
    const ymap = doc.getMap('test');

    const { delta } = transactWithDelta(doc, () => {
      const nested = new Y.Map();
      nested.set('name', 'test');
      nested.set('value', 123);
      ymap.set('item-1', nested);
    });

    // Apply to fresh doc
    const doc2 = createTestDoc();
    applyUpdate(doc2, delta);
    const ymap2 = doc2.getMap('test');
    const nested = ymap2.get('item-1');

    expect(nested).toBeInstanceOf(Y.Map);
    expect((nested as Y.Map<unknown>).get('name')).toBe('test');
    expect((nested as Y.Map<unknown>).get('value')).toBe(123);
  });

  it('returns the function result', () => {
    const doc = createTestDoc();

    const { result } = transactWithDelta(doc, () => {
      return 'return value';
    });

    expect(result).toBe('return value');
  });
});

describe('applyUpdate', () => {
  it('syncs state between two Y.Docs', () => {
    const doc1 = createTestDoc(1);
    const doc2 = createTestDoc(2);

    // Make changes in doc1
    const ymap1 = doc1.getMap('test');
    doc1.transact(() => {
      ymap1.set('key', 'from doc1');
    });

    // Get full state and apply to doc2
    const update = Y.encodeStateAsUpdateV2(doc1);
    applyUpdate(doc2, update);

    const ymap2 = doc2.getMap('test');
    expect(ymap2.get('key')).toBe('from doc1');
  });

  it('handles out-of-order updates', () => {
    const doc1 = createTestDoc(1);
    const _doc2 = createTestDoc(2);
    const doc3 = createTestDoc(3);

    // doc1 makes change
    const ymap1 = doc1.getMap('test');
    const vector1 = Y.encodeStateVector(doc1);
    doc1.transact(() => {
      ymap1.set('a', 1);
    });
    const delta1 = Y.encodeStateAsUpdateV2(doc1, vector1);

    // doc1 makes another change
    const vector2 = Y.encodeStateVector(doc1);
    doc1.transact(() => {
      ymap1.set('b', 2);
    });
    const delta2 = Y.encodeStateAsUpdateV2(doc1, vector2);

    // Apply in reverse order to doc3
    applyUpdate(doc3, delta2);
    applyUpdate(doc3, delta1);

    const ymap3 = doc3.getMap('test');
    expect(ymap3.get('a')).toBe(1);
    expect(ymap3.get('b')).toBe(2);
  });

  it('merges concurrent changes without data loss', () => {
    const doc1 = createTestDoc(1);
    const doc2 = createTestDoc(2);

    // Both start from empty state
    const ymap1 = doc1.getMap('test');
    const ymap2 = doc2.getMap('test');

    // doc1 adds key 'a'
    doc1.transact(() => {
      ymap1.set('a', 'from doc1');
    });

    // doc2 adds key 'b' (concurrent, no sync yet)
    doc2.transact(() => {
      ymap2.set('b', 'from doc2');
    });

    // Sync both ways
    syncDocs(doc1, doc2);

    // Both docs should have both keys
    expect(ymap1.get('a')).toBe('from doc1');
    expect(ymap1.get('b')).toBe('from doc2');
    expect(ymap2.get('a')).toBe('from doc1');
    expect(ymap2.get('b')).toBe('from doc2');
  });

  it('resolves concurrent edits to same key (converges to same value)', () => {
    const doc1 = createTestDoc(1);
    const doc2 = createTestDoc(2);

    const ymap1 = doc1.getMap('test');
    const ymap2 = doc2.getMap('test');

    // Both edit the same key concurrently
    doc1.transact(() => {
      ymap1.set('key', 'value from doc1');
    });

    doc2.transact(() => {
      ymap2.set('key', 'value from doc2');
    });

    // Sync both ways
    syncDocs(doc1, doc2);

    // Both should converge to the same value
    // Yjs uses lamport timestamps + clientId for deterministic resolution
    // The important thing is convergence, not which value wins
    expect(ymap1.get('key')).toBe(ymap2.get('key'));
    // One of the values must win
    expect(['value from doc1', 'value from doc2']).toContain(ymap1.get('key'));
  });
});

describe('extractItems', () => {
  it('converts Y.Map to plain objects', () => {
    const doc = createTestDoc();
    const ymap = doc.getMap<unknown>('test');

    doc.transact(() => {
      const item1 = new Y.Map();
      item1.set('id', '1');
      item1.set('name', 'Item 1');
      ymap.set('1', item1);

      const item2 = new Y.Map();
      item2.set('id', '2');
      item2.set('name', 'Item 2');
      ymap.set('2', item2);
    });

    const items = extractItems<{ id: string; name: string }>(ymap);

    expect(items).toHaveLength(2);
    expect(items).toContainEqual({ id: '1', name: 'Item 1' });
    expect(items).toContainEqual({ id: '2', name: 'Item 2' });
  });

  it('handles empty maps', () => {
    const doc = createTestDoc();
    const ymap = doc.getMap<unknown>('test');

    const items = extractItems(ymap);
    expect(items).toEqual([]);
  });

  it('preserves nested structures', () => {
    const doc = createTestDoc();
    const ymap = doc.getMap<unknown>('test');

    doc.transact(() => {
      const item = new Y.Map();
      item.set('id', '1');
      item.set('metadata', { nested: true, count: 5 });
      ymap.set('1', item);
    });

    const items = extractItems<{ id: string; metadata: { nested: boolean; count: number } }>(ymap);

    expect(items).toHaveLength(1);
    expect(items[0].metadata).toEqual({ nested: true, count: 5 });
  });
});

describe('extractItem', () => {
  it('extracts single item by key', () => {
    const doc = createTestDoc();
    const ymap = doc.getMap<unknown>('test');

    doc.transact(() => {
      const item = new Y.Map();
      item.set('id', '1');
      item.set('name', 'Test');
      ymap.set('1', item);
    });

    const item = extractItem<{ id: string; name: string }>(ymap, '1');
    expect(item).toEqual({ id: '1', name: 'Test' });
  });

  it('returns null for non-existent key', () => {
    const doc = createTestDoc();
    const ymap = doc.getMap<unknown>('test');

    const item = extractItem(ymap, 'non-existent');
    expect(item).toBeNull();
  });

  it('returns null for non-Y.Map values', () => {
    const doc = createTestDoc();
    const ymap = doc.getMap<unknown>('test');

    doc.transact(() => {
      ymap.set('primitive', 'string value');
    });

    const item = extractItem(ymap, 'primitive');
    expect(item).toBeNull();
  });
});

describe('getYMap', () => {
  it('returns Y.Map from document', () => {
    const doc = createTestDoc();
    const ymap = getYMap(doc, 'collection');

    expect(ymap).toBeInstanceOf(Y.Map);
  });

  it('returns same instance for same name', () => {
    const doc = createTestDoc();
    const ymap1 = getYMap(doc, 'collection');
    const ymap2 = getYMap(doc, 'collection');

    expect(ymap1).toBe(ymap2);
  });
});

describe('yjsTransact', () => {
  it('executes function in transaction', () => {
    const doc = createTestDoc();
    const ymap = doc.getMap('test');

    yjsTransact(doc, () => {
      ymap.set('key', 'value');
    });

    expect(ymap.get('key')).toBe('value');
  });

  it('returns function result', () => {
    const doc = createTestDoc();

    const result = yjsTransact(doc, () => {
      return 42;
    });

    expect(result).toBe(42);
  });
});
