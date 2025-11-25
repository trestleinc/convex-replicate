import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { YjsService, YjsServiceLive, IDBServiceLive } from '../../client/services/index.js';
import * as Y from 'yjs';

describe('YjsService', () => {
  const testLayer = Layer.provide(YjsServiceLive, IDBServiceLive);

  it('creates document with unique clientId', async () => {
    const doc = await Effect.runPromise(
      Effect.gen(function* () {
        const yjs = yield* YjsService;
        const doc = yield* yjs.createDocument('test-collection');

        expect(doc).toBeInstanceOf(Y.Doc);
        expect(doc.clientID).toBeTypeOf('number');
        expect(doc.clientID).toBeGreaterThan(0);

        return doc;
      }).pipe(Effect.provide(testLayer))
    );

    expect(doc.guid).toBe('test-collection');
  });

  it('returns Y.Map from document', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const yjs = yield* YjsService;
        const doc = yield* yjs.createDocument('test');
        const map = yield* yjs.getMap<any>(doc, 'test');

        expect(map).toBeInstanceOf(Y.Map);
        expect(map.doc).toBe(doc);
      }).pipe(Effect.provide(testLayer))
    );
  });

  it('executes transaction with correct origin', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const yjs = yield* YjsService;
        const doc = yield* yjs.createDocument('test');
        const map = yield* yjs.getMap<any>(doc, 'test');

        let capturedOrigin: string | null = null;
        doc.on('update', (_update, origin) => {
          capturedOrigin = origin as string;
        });

        yield* yjs.transact(
          doc,
          () => {
            map.set('key', 'value');
          },
          'test-origin'
        );

        expect(capturedOrigin).toBe('test-origin');
        expect(map.get('key')).toBe('value');
      }).pipe(Effect.provide(testLayer))
    );
  });

  it('applies binary update to document', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const yjs = yield* YjsService;

        // Create two documents
        const doc1 = yield* yjs.createDocument('test');
        const doc2 = yield* yjs.createDocument('test');

        const map1 = yield* yjs.getMap<any>(doc1, 'test');
        const map2 = yield* yjs.getMap<any>(doc2, 'test');

        // Make change in doc1
        let capturedUpdate: Uint8Array | null = null;
        doc1.on('updateV2', (update) => {
          capturedUpdate = update;
        });

        yield* yjs.transact(
          doc1,
          () => {
            map1.set('foo', 'bar');
          },
          'test'
        );

        expect(capturedUpdate).toBeTruthy();
        if (!capturedUpdate) throw new Error('Update not captured');

        // Apply to doc2 (uses updateV2 format)
        yield* yjs.applyUpdate(doc2, capturedUpdate, 'sync');

        expect(map2.get('foo')).toBe('bar');
      }).pipe(Effect.provide(testLayer))
    );
  });

  it('fires callback on document changes', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const yjs = yield* YjsService;
        const doc = yield* yjs.createDocument('test');
        const map = yield* yjs.getMap<any>(doc, 'test');

        let updateCount = 0;
        let lastUpdate: Uint8Array | null = null;
        let lastOrigin: string | null = null;

        yield* yjs.observeUpdates(doc, (update, origin) => {
          updateCount++;
          lastUpdate = update;
          lastOrigin = origin as string;
        });

        // Make first change
        yield* yjs.transact(
          doc,
          () => {
            map.set('key1', 'value1');
          },
          'origin1'
        );

        expect(updateCount).toBe(1);
        expect(lastOrigin).toBe('origin1');
        expect(lastUpdate).toBeTruthy();

        // Make second change
        yield* yjs.transact(
          doc,
          () => {
            map.set('key2', 'value2');
          },
          'origin2'
        );

        expect(updateCount).toBe(2);
        expect(lastOrigin).toBe('origin2');
      }).pipe(Effect.provide(testLayer))
    );
  });

  it('returns cleanup function that unsubscribes', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const yjs = yield* YjsService;
        const doc = yield* yjs.createDocument('test');
        const map = yield* yjs.getMap<any>(doc, 'test');

        let updateCount = 0;

        const cleanup = yield* yjs.observeUpdates(doc, () => {
          updateCount++;
        });

        // Make change - should fire
        yield* yjs.transact(
          doc,
          () => {
            map.set('key1', 'value1');
          },
          'test'
        );

        expect(updateCount).toBe(1);

        // Cleanup
        cleanup();

        // Make another change - should NOT fire
        yield* yjs.transact(
          doc,
          () => {
            map.set('key2', 'value2');
          },
          'test'
        );

        expect(updateCount).toBe(1); // Still 1, not incremented
      }).pipe(Effect.provide(testLayer))
    );
  });

  it('handles multiple concurrent transactions', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const yjs = yield* YjsService;
        const doc = yield* yjs.createDocument('test');
        const map = yield* yjs.getMap<any>(doc, 'test');

        // Run transactions concurrently
        yield* Effect.all(
          [
            yjs.transact(
              doc,
              () => {
                map.set('key1', 'value1');
              },
              'txn1'
            ),
            yjs.transact(
              doc,
              () => {
                map.set('key2', 'value2');
              },
              'txn2'
            ),
            yjs.transact(
              doc,
              () => {
                map.set('key3', 'value3');
              },
              'txn3'
            ),
          ],
          { concurrency: 'unbounded' }
        );

        expect(map.get('key1')).toBe('value1');
        expect(map.get('key2')).toBe('value2');
        expect(map.get('key3')).toBe('value3');
      }).pipe(Effect.provide(testLayer))
    );
  });
});
