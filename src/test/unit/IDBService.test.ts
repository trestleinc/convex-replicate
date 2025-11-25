import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { IDBService, IDBServiceLive } from '../../client/services/index.js';

describe('IDBService', () => {
  it('sets and gets value from IndexedDB', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const idb = yield* IDBService;

        // Set a value
        yield* idb.set('test-key', 'test-value');

        // Get it back
        const value = yield* idb.get<string>('test-key');

        expect(value).toBe('test-value');
      }).pipe(Effect.provide(IDBServiceLive))
    );
  });

  it('returns undefined for non-existent key', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const idb = yield* IDBService;

        const value = yield* idb.get<string>('non-existent-key');

        expect(value).toBeUndefined();
      }).pipe(Effect.provide(IDBServiceLive))
    );
  });

  it('updates existing values', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const idb = yield* IDBService;

        // Set initial value
        yield* idb.set('existing-key', 100);

        // Update it
        yield* idb.set('existing-key', 200);

        const value = yield* idb.get<number>('existing-key');

        expect(value).toBe(200);
      }).pipe(Effect.provide(IDBServiceLive))
    );
  });

  it('handles storing complex objects', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const idb = yield* IDBService;

        const complexObject = {
          id: 1,
          name: 'Test',
          nested: {
            value: 100,
            array: [1, 2, 3],
          },
        };

        yield* idb.set('complex-key', complexObject);

        const retrieved = yield* idb.get<typeof complexObject>('complex-key');

        expect(retrieved).toEqual(complexObject);
      }).pipe(Effect.provide(IDBServiceLive))
    );
  });

  it('handles storing numbers', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const idb = yield* IDBService;

        yield* idb.set('number-key', 12345);

        const value = yield* idb.get<number>('number-key');

        expect(value).toBe(12345);
      }).pipe(Effect.provide(IDBServiceLive))
    );
  });

  it('handles storing booleans', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const idb = yield* IDBService;

        yield* idb.set('bool-key', true);

        const value = yield* idb.get<boolean>('bool-key');

        expect(value).toBe(true);
      }).pipe(Effect.provide(IDBServiceLive))
    );
  });

  it('overwrites existing values', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const idb = yield* IDBService;

        yield* idb.set('overwrite-key', 'first');
        yield* idb.set('overwrite-key', 'second');

        const value = yield* idb.get<string>('overwrite-key');

        expect(value).toBe('second');
      }).pipe(Effect.provide(IDBServiceLive))
    );
  });

  it('handles multiple keys independently', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const idb = yield* IDBService;

        yield* idb.set('key1', 'value1');
        yield* idb.set('key2', 'value2');
        yield* idb.set('key3', 'value3');

        const value1 = yield* idb.get<string>('key1');
        const value2 = yield* idb.get<string>('key2');
        const value3 = yield* idb.get<string>('key3');

        expect(value1).toBe('value1');
        expect(value2).toBe('value2');
        expect(value3).toBe('value3');
      }).pipe(Effect.provide(IDBServiceLive))
    );
  });

  it('handles array values', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const idb = yield* IDBService;

        const array = [1, 2, 3, 4, 5];
        yield* idb.set('array-key', array);

        const retrieved = yield* idb.get<number[]>('array-key');

        expect(retrieved).toEqual(array);
      }).pipe(Effect.provide(IDBServiceLive))
    );
  });
});
