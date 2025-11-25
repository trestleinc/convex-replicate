import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import { OptimisticService, OptimisticServiceLive } from '../../client/services/index.js';

describe('OptimisticService', () => {
  const createMockSyncParams = () => {
    return {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      truncate: vi.fn(),
    };
  };

  it('stores syncParams after initialization', async () => {
    const mockParams = createMockSyncParams();

    await Effect.runPromise(
      Effect.gen(function* () {
        const optimistic = yield* OptimisticService;
        yield* optimistic.initialize(mockParams);

        // Initialization should complete without error
        expect(mockParams).toBeDefined();
      }).pipe(Effect.provide(OptimisticServiceLive))
    );
  });

  it('throws OptimisticWriteError when not initialized', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const optimistic = yield* OptimisticService;

        // Try to insert without initializing
        return yield* optimistic.insert([{ id: '1', title: 'Test' }]);
      }).pipe(Effect.provide(OptimisticServiceLive), Effect.either)
    );

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left._tag).toBe('OptimisticWriteError');
      expect(result.left.operation).toBe('insert');
    }
  });

  it('calls syncParams methods for insert operation', async () => {
    const mockParams = createMockSyncParams();

    await Effect.runPromise(
      Effect.gen(function* () {
        const optimistic = yield* OptimisticService;
        yield* optimistic.initialize(mockParams);

        const items = [
          { id: '1', title: 'Task 1' },
          { id: '2', title: 'Task 2' },
        ];

        yield* optimistic.insert(items);

        // Verify begin was called once
        expect(mockParams.begin).toHaveBeenCalledTimes(1);

        // Verify write was called for each item
        expect(mockParams.write).toHaveBeenCalledTimes(2);
        expect(mockParams.write).toHaveBeenCalledWith({
          type: 'insert',
          value: items[0],
        });
        expect(mockParams.write).toHaveBeenCalledWith({
          type: 'insert',
          value: items[1],
        });

        // Verify commit was called once
        expect(mockParams.commit).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(OptimisticServiceLive))
    );
  });

  it('calls syncParams methods for update operation', async () => {
    const mockParams = createMockSyncParams();

    await Effect.runPromise(
      Effect.gen(function* () {
        const optimistic = yield* OptimisticService;
        yield* optimistic.initialize(mockParams);

        const items = [{ id: '1', title: 'Updated Task' }];

        yield* optimistic.update(items);

        expect(mockParams.begin).toHaveBeenCalledTimes(1);
        expect(mockParams.write).toHaveBeenCalledWith({
          type: 'update',
          value: items[0],
        });
        expect(mockParams.commit).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(OptimisticServiceLive))
    );
  });

  it('calls syncParams methods for delete operation', async () => {
    const mockParams = createMockSyncParams();

    await Effect.runPromise(
      Effect.gen(function* () {
        const optimistic = yield* OptimisticService;
        yield* optimistic.initialize(mockParams);

        const items = [{ id: '1', title: 'Task to delete' }];

        yield* optimistic.delete(items);

        expect(mockParams.begin).toHaveBeenCalledTimes(1);
        expect(mockParams.write).toHaveBeenCalledWith({
          type: 'delete',
          value: items[0],
        });
        expect(mockParams.commit).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(OptimisticServiceLive))
    );
  });

  it('handles empty array for insert', async () => {
    const mockParams = createMockSyncParams();

    await Effect.runPromise(
      Effect.gen(function* () {
        const optimistic = yield* OptimisticService;
        yield* optimistic.initialize(mockParams);

        yield* optimistic.insert([]);

        // Should still call begin and commit even with empty array
        expect(mockParams.begin).toHaveBeenCalledTimes(1);
        expect(mockParams.write).not.toHaveBeenCalled();
        expect(mockParams.commit).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(OptimisticServiceLive))
    );
  });

  it('calls truncate for truncate operation', async () => {
    const mockParams = createMockSyncParams();

    await Effect.runPromise(
      Effect.gen(function* () {
        const optimistic = yield* OptimisticService;
        yield* optimistic.initialize(mockParams);

        yield* optimistic.truncate();

        expect(mockParams.truncate).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(OptimisticServiceLive))
    );
  });

  it('replaceAll calls truncate then insert', async () => {
    const mockParams = createMockSyncParams();

    await Effect.runPromise(
      Effect.gen(function* () {
        const optimistic = yield* OptimisticService;
        yield* optimistic.initialize(mockParams);

        const items = [
          { id: '1', title: 'New Task 1' },
          { id: '2', title: 'New Task 2' },
        ];

        yield* optimistic.replaceAll(items);

        // Should call truncate first
        expect(mockParams.truncate).toHaveBeenCalledTimes(1);

        // Then begin, write for each item, and commit
        expect(mockParams.begin).toHaveBeenCalledTimes(1);
        expect(mockParams.write).toHaveBeenCalledTimes(2);
        expect(mockParams.commit).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(OptimisticServiceLive))
    );
  });

  it('upsert calls correct write messages', async () => {
    const mockParams = createMockSyncParams();

    await Effect.runPromise(
      Effect.gen(function* () {
        const optimistic = yield* OptimisticService;
        yield* optimistic.initialize(mockParams);

        const items = [{ id: '1', title: 'Upserted Task' }];

        yield* optimistic.upsert(items);

        expect(mockParams.begin).toHaveBeenCalledTimes(1);
        // upsert uses 'update' type internally
        expect(mockParams.write).toHaveBeenCalledWith({
          type: 'update',
          value: items[0],
        });
        expect(mockParams.commit).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(OptimisticServiceLive))
    );
  });

  it('handles batch insert of many items', async () => {
    const mockParams = createMockSyncParams();

    await Effect.runPromise(
      Effect.gen(function* () {
        const optimistic = yield* OptimisticService;
        yield* optimistic.initialize(mockParams);

        // Create 100 items
        const items = Array.from({ length: 100 }, (_, i) => ({
          id: `${i}`,
          title: `Task ${i}`,
        }));

        yield* optimistic.insert(items);

        expect(mockParams.begin).toHaveBeenCalledTimes(1);
        expect(mockParams.write).toHaveBeenCalledTimes(100);
        expect(mockParams.commit).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(OptimisticServiceLive))
    );
  });

  it('handles syncParams.write throwing error', async () => {
    const mockParams = createMockSyncParams();
    mockParams.write.mockImplementation(() => {
      throw new Error('Write failed');
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const optimistic = yield* OptimisticService;
        yield* optimistic.initialize(mockParams);

        return yield* optimistic.insert([{ id: '1', title: 'Test' }]);
      }).pipe(Effect.provide(OptimisticServiceLive), Effect.either)
    );

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left._tag).toBe('OptimisticWriteError');
      expect(result.left.operation).toBe('insert');
    }
  });
});
