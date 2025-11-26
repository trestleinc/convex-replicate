import { describe, it, expect, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { del as idbDel } from 'idb-keyval';
import * as Y from 'yjs';
import { Reconciliation, ReconciliationLive } from '$/client/services/reconciliation.js';
import { createYjsDocument, getYMap, yjsTransact } from '$/client/merge.js';

describe('Reconciliation', () => {
  // ReconciliationLive now uses plain merge helpers - no YjsService dependency
  const testLayer = ReconciliationLive;

  interface TestDoc {
    id: string;
    title: string;
  }

  const getKey = (doc: TestDoc) => doc.id;

  beforeEach(async () => {
    await idbDel('yjsClientId:test-collection');
  });

  it('returns empty array when no phantom documents', async () => {
    const ydoc = await createYjsDocument('test-collection');
    const ymap = getYMap<unknown>(ydoc, 'test-collection');

    // Add docs to Yjs that match server
    yjsTransact(
      ydoc,
      () => {
        const doc1Map = new Y.Map();
        doc1Map.set('id', 'doc1');
        doc1Map.set('title', 'Document 1');
        ymap.set('doc1', doc1Map);
      },
      'test'
    );

    const serverDocs: TestDoc[] = [{ id: 'doc1', title: 'Document 1' }];

    const removed = await Effect.runPromise(
      Effect.gen(function* () {
        const reconciliation = yield* Reconciliation;
        return yield* reconciliation.reconcile(ydoc, ymap, 'test-collection', serverDocs, getKey);
      }).pipe(Effect.provide(testLayer))
    );

    expect(removed).toEqual([]);
    ydoc.destroy();
  });

  it('removes phantom documents not on server', async () => {
    const ydoc = await createYjsDocument('test-collection');
    const ymap = getYMap<unknown>(ydoc, 'test-collection');

    // Add 3 docs to Yjs
    yjsTransact(
      ydoc,
      () => {
        for (const id of ['doc1', 'doc2', 'doc3']) {
          const docMap = new Y.Map();
          docMap.set('id', id);
          docMap.set('title', `Document ${id}`);
          ymap.set(id, docMap);
        }
      },
      'test'
    );

    // Server only has doc1 - doc2 and doc3 are phantoms
    const serverDocs: TestDoc[] = [{ id: 'doc1', title: 'Document 1' }];

    const removed = await Effect.runPromise(
      Effect.gen(function* () {
        const reconciliation = yield* Reconciliation;
        return yield* reconciliation.reconcile(ydoc, ymap, 'test-collection', serverDocs, getKey);
      }).pipe(Effect.provide(testLayer))
    );

    // Should return the removed items
    expect(removed).toHaveLength(2);
    expect(removed.map((r) => r.id).sort()).toEqual(['doc2', 'doc3']);

    // Verify they're removed from ymap
    expect(ymap.get('doc1')).toBeDefined();
    expect(ymap.get('doc2')).toBeUndefined();
    expect(ymap.get('doc3')).toBeUndefined();

    ydoc.destroy();
  });

  it('handles empty local state', async () => {
    const ydoc = await createYjsDocument('test-collection');
    const ymap = getYMap<unknown>(ydoc, 'test-collection');

    // Empty Yjs state
    const serverDocs: TestDoc[] = [
      { id: 'doc1', title: 'Document 1' },
      { id: 'doc2', title: 'Document 2' },
    ];

    const removed = await Effect.runPromise(
      Effect.gen(function* () {
        const reconciliation = yield* Reconciliation;
        return yield* reconciliation.reconcile(ydoc, ymap, 'test-collection', serverDocs, getKey);
      }).pipe(Effect.provide(testLayer))
    );

    expect(removed).toEqual([]);
    ydoc.destroy();
  });

  it('handles empty server state', async () => {
    const ydoc = await createYjsDocument('test-collection');
    const ymap = getYMap<unknown>(ydoc, 'test-collection');

    // Add local docs
    yjsTransact(
      ydoc,
      () => {
        const doc1Map = new Y.Map();
        doc1Map.set('id', 'doc1');
        doc1Map.set('title', 'Document 1');
        ymap.set('doc1', doc1Map);
      },
      'test'
    );

    // Empty server state - all local docs are phantoms
    const serverDocs: TestDoc[] = [];

    const removed = await Effect.runPromise(
      Effect.gen(function* () {
        const reconciliation = yield* Reconciliation;
        return yield* reconciliation.reconcile(ydoc, ymap, 'test-collection', serverDocs, getKey);
      }).pipe(Effect.provide(testLayer))
    );

    expect(removed).toHaveLength(1);
    expect(removed[0].id).toBe('doc1');
    expect(ymap.get('doc1')).toBeUndefined();

    ydoc.destroy();
  });

  it('preserves server documents during reconciliation', async () => {
    const ydoc = await createYjsDocument('test-collection');
    const ymap = getYMap<unknown>(ydoc, 'test-collection');

    // Add docs
    yjsTransact(
      ydoc,
      () => {
        for (const id of ['keep1', 'phantom1', 'keep2', 'phantom2']) {
          const docMap = new Y.Map();
          docMap.set('id', id);
          docMap.set('title', `Document ${id}`);
          ymap.set(id, docMap);
        }
      },
      'test'
    );

    const serverDocs: TestDoc[] = [
      { id: 'keep1', title: 'Keep 1' },
      { id: 'keep2', title: 'Keep 2' },
    ];

    await Effect.runPromise(
      Effect.gen(function* () {
        const reconciliation = yield* Reconciliation;
        yield* reconciliation.reconcile(ydoc, ymap, 'test-collection', serverDocs, getKey);
      }).pipe(Effect.provide(testLayer))
    );

    // Verify kept docs still exist
    expect(ymap.get('keep1')).toBeDefined();
    expect(ymap.get('keep2')).toBeDefined();

    // Verify phantoms removed
    expect(ymap.get('phantom1')).toBeUndefined();
    expect(ymap.get('phantom2')).toBeUndefined();

    ydoc.destroy();
  });

  it('returns removed items with correct shape', async () => {
    const ydoc = await createYjsDocument('test-collection');
    const ymap = getYMap<unknown>(ydoc, 'test-collection');

    // Add doc with multiple fields
    yjsTransact(
      ydoc,
      () => {
        const docMap = new Y.Map();
        docMap.set('id', 'phantom');
        docMap.set('title', 'Phantom Doc');
        docMap.set('extra', 'extra-value');
        ymap.set('phantom', docMap);
      },
      'test'
    );

    const serverDocs: TestDoc[] = [];

    const removed = await Effect.runPromise(
      Effect.gen(function* () {
        const reconciliation = yield* Reconciliation;
        return yield* reconciliation.reconcile(ydoc, ymap, 'test-collection', serverDocs, getKey);
      }).pipe(Effect.provide(testLayer))
    );

    expect(removed).toHaveLength(1);
    expect(removed[0]).toEqual({
      id: 'phantom',
      title: 'Phantom Doc',
      extra: 'extra-value',
    });

    ydoc.destroy();
  });

  it('handles large number of phantom documents', async () => {
    const ydoc = await createYjsDocument('test-collection');
    const ymap = getYMap<unknown>(ydoc, 'test-collection');

    // Add 100 docs
    yjsTransact(
      ydoc,
      () => {
        for (let i = 0; i < 100; i++) {
          const docMap = new Y.Map();
          docMap.set('id', `doc${i}`);
          docMap.set('title', `Document ${i}`);
          ymap.set(`doc${i}`, docMap);
        }
      },
      'test'
    );

    // Server only has first 10
    const serverDocs: TestDoc[] = Array.from({ length: 10 }, (_, i) => ({
      id: `doc${i}`,
      title: `Document ${i}`,
    }));

    const removed = await Effect.runPromise(
      Effect.gen(function* () {
        const reconciliation = yield* Reconciliation;
        return yield* reconciliation.reconcile(ydoc, ymap, 'test-collection', serverDocs, getKey);
      }).pipe(Effect.provide(testLayer))
    );

    // 90 phantoms should be removed
    expect(removed).toHaveLength(90);

    // Verify first 10 still exist
    for (let i = 0; i < 10; i++) {
      expect(ymap.get(`doc${i}`)).toBeDefined();
    }

    // Verify rest are removed
    for (let i = 10; i < 100; i++) {
      expect(ymap.get(`doc${i}`)).toBeUndefined();
    }

    ydoc.destroy();
  });
});
