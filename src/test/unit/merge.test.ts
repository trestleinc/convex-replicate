import { describe, it, expect, beforeEach } from 'vitest';
import { del as idbDel } from 'idb-keyval';
import * as Y from 'yjs';
import {
  createYjsDocument,
  applyUpdate,
  getYMap,
  yjsTransact,
  transactWithDelta,
} from '$/client/merge.js';

describe('Merge Helpers', () => {
  beforeEach(async () => {
    // Clear any stored clientId between tests
    await idbDel('yjsClientId:test-collection');
    await idbDel('yjsClientId:test');
    await idbDel('yjsClientId:test1');
    await idbDel('yjsClientId:test2');
    await idbDel('yjsClientId:sender');
    await idbDel('yjsClientId:receiver');
  });

  describe('createYjsDocument', () => {
    it('creates document with unique clientId', async () => {
      const doc = await createYjsDocument('test-collection');

      expect(doc).toBeInstanceOf(Y.Doc);
      expect(doc.clientID).toBeTypeOf('number');
      expect(doc.clientID).toBeGreaterThan(0);
      expect(doc.guid).toBe('test-collection');

      doc.destroy();
    });
  });

  describe('getYMap', () => {
    it('returns Y.Map from document', async () => {
      const doc = await createYjsDocument('test');
      const map = getYMap<any>(doc, 'test');

      expect(map).toBeInstanceOf(Y.Map);
      expect(map.doc).toBe(doc);

      doc.destroy();
    });
  });

  describe('yjsTransact', () => {
    it('executes transaction with correct origin', async () => {
      const doc = await createYjsDocument('test');
      const map = getYMap<any>(doc, 'test');

      let capturedOrigin: string | null = null;
      doc.on('update', (_update, origin) => {
        capturedOrigin = origin as string;
      });

      yjsTransact(
        doc,
        () => {
          map.set('key', 'value');
        },
        'test-origin'
      );

      expect(capturedOrigin).toBe('test-origin');
      expect(map.get('key')).toBe('value');

      doc.destroy();
    });
  });

  describe('applyUpdate', () => {
    it('applies binary update to document', async () => {
      const doc1 = await createYjsDocument('test');
      const doc2 = await createYjsDocument('test');

      const map1 = getYMap<any>(doc1, 'test');
      const map2 = getYMap<any>(doc2, 'test');

      // Make change in doc1
      let capturedUpdate: Uint8Array | null = null;
      doc1.on('updateV2', (update) => {
        capturedUpdate = update;
      });

      yjsTransact(
        doc1,
        () => {
          map1.set('foo', 'bar');
        },
        'test'
      );

      expect(capturedUpdate).toBeTruthy();
      if (!capturedUpdate) throw new Error('Update not captured');

      // Apply to doc2 (uses updateV2 format)
      applyUpdate(doc2, capturedUpdate, 'sync');

      expect(map2.get('foo')).toBe('bar');

      doc1.destroy();
      doc2.destroy();
    });
  });

  describe('transactWithDelta', () => {
    it('captures delta from transaction', async () => {
      const doc = await createYjsDocument('test');
      const map = getYMap<any>(doc, 'test');

      const { result, delta } = transactWithDelta(
        doc,
        () => {
          map.set('key', 'value');
          return 'done';
        },
        'test-origin'
      );

      expect(result).toBe('done');
      expect(delta).toBeInstanceOf(Uint8Array);
      expect(delta.length).toBeGreaterThan(0);
      expect(map.get('key')).toBe('value');

      doc.destroy();
    });

    it('delta can be applied to another document', async () => {
      const doc1 = await createYjsDocument('test1');
      const doc2 = await createYjsDocument('test2');

      const map1 = getYMap<any>(doc1, 'test');
      const map2 = getYMap<any>(doc2, 'test');

      // Make change in doc1 and capture delta
      const { delta } = transactWithDelta(
        doc1,
        () => {
          map1.set('foo', 'bar');
        },
        'sync'
      );

      // Apply delta to doc2
      applyUpdate(doc2, delta, 'remote');

      // doc2 should now have the same value
      expect(map2.get('foo')).toBe('bar');

      doc1.destroy();
      doc2.destroy();
    });

    it('handles rapid sequential transactions correctly', async () => {
      const doc = await createYjsDocument('test');
      const map = getYMap<any>(doc, 'test');

      const deltas: Uint8Array[] = [];

      // Perform multiple rapid transactions
      for (let i = 0; i < 5; i++) {
        const { delta } = transactWithDelta(
          doc,
          () => {
            map.set(`key-${i}`, `value-${i}`);
          },
          'rapid'
        );
        deltas.push(delta);
      }

      // All deltas should be captured
      expect(deltas.length).toBe(5);

      // Each delta should be non-empty
      for (const delta of deltas) {
        expect(delta.length).toBeGreaterThan(0);
      }

      // All values should be present
      for (let i = 0; i < 5; i++) {
        expect(map.get(`key-${i}`)).toBe(`value-${i}`);
      }

      doc.destroy();
    });

    it('each delta contains only its own changes', async () => {
      const sender = await createYjsDocument('sender');
      const receiver = await createYjsDocument('receiver');

      const senderMap = getYMap<any>(sender, 'test');
      const receiverMap = getYMap<any>(receiver, 'test');

      // First transaction
      const { delta: delta1 } = transactWithDelta(
        sender,
        () => {
          senderMap.set('first', 'A');
        },
        'op1'
      );

      // Second transaction
      const { delta: delta2 } = transactWithDelta(
        sender,
        () => {
          senderMap.set('second', 'B');
        },
        'op2'
      );

      // Apply only delta1 to receiver
      applyUpdate(receiver, delta1, 'remote');

      // Receiver should only have 'first', not 'second'
      expect(receiverMap.get('first')).toBe('A');
      expect(receiverMap.get('second')).toBeUndefined();

      // Now apply delta2
      applyUpdate(receiver, delta2, 'remote');

      // Now receiver should have both
      expect(receiverMap.get('first')).toBe('A');
      expect(receiverMap.get('second')).toBe('B');

      sender.destroy();
      receiver.destroy();
    });

    it('returns empty delta when no changes are made', async () => {
      const doc = await createYjsDocument('test');

      // Transaction that makes no changes
      const { delta } = transactWithDelta(
        doc,
        () => {
          // No operations
        },
        'empty'
      );

      // Delta should exist but be minimal (just header, no actual changes)
      expect(delta).toBeInstanceOf(Uint8Array);

      doc.destroy();
    });
  });
});
