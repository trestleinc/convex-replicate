import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  initializeReplicateParams,
  replicateInsert,
  replicateDelete,
  replicateUpsert,
  replicateReplace,
} from '$/client/replicate.js';

// Mock version of ReplicateParams for testing
interface MockReplicateParams {
  begin: Mock;
  write: Mock;
  commit: Mock;
  truncate: Mock;
}

describe('Replicate Helpers', () => {
  const createMockReplicateParams = (): MockReplicateParams => {
    return {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      truncate: vi.fn(),
    };
  };

  it('stores replicateParams after initialization', () => {
    const mockParams = createMockReplicateParams();
    initializeReplicateParams(mockParams);
    // Initialization should complete without error
    expect(mockParams).toBeDefined();
  });

  it('calls replicateParams methods for insert operation', () => {
    const mockParams = createMockReplicateParams();
    initializeReplicateParams(mockParams);

    const items = [
      { id: '1', title: 'Task 1' },
      { id: '2', title: 'Task 2' },
    ];

    replicateInsert(items);

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
  });

  it('calls replicateParams methods for delete operation', () => {
    const mockParams = createMockReplicateParams();
    initializeReplicateParams(mockParams);

    const items = [{ id: '1', title: 'Task to delete' }];

    replicateDelete(items);

    expect(mockParams.begin).toHaveBeenCalledTimes(1);
    expect(mockParams.write).toHaveBeenCalledWith({
      type: 'delete',
      value: items[0],
    });
    expect(mockParams.commit).toHaveBeenCalledTimes(1);
  });

  it('handles empty array for insert', () => {
    const mockParams = createMockReplicateParams();
    initializeReplicateParams(mockParams);

    replicateInsert([]);

    // Should still call begin and commit even with empty array
    expect(mockParams.begin).toHaveBeenCalledTimes(1);
    expect(mockParams.write).not.toHaveBeenCalled();
    expect(mockParams.commit).toHaveBeenCalledTimes(1);
  });

  it('replace calls truncate then insert', () => {
    const mockParams = createMockReplicateParams();
    initializeReplicateParams(mockParams);

    const items = [
      { id: '1', title: 'New Task 1' },
      { id: '2', title: 'New Task 2' },
    ];

    replicateReplace(items);

    // Should call truncate first
    expect(mockParams.truncate).toHaveBeenCalledTimes(1);

    // Then begin, write for each item, and commit
    expect(mockParams.begin).toHaveBeenCalledTimes(1);
    expect(mockParams.write).toHaveBeenCalledTimes(2);
    expect(mockParams.commit).toHaveBeenCalledTimes(1);
  });

  it('upsert calls correct write messages', () => {
    const mockParams = createMockReplicateParams();
    initializeReplicateParams(mockParams);

    const items = [{ id: '1', title: 'Upserted Task' }];

    replicateUpsert(items);

    expect(mockParams.begin).toHaveBeenCalledTimes(1);
    // upsert uses 'update' type - TanStack DB only recognizes insert/update/delete
    expect(mockParams.write).toHaveBeenCalledWith({
      type: 'update',
      value: items[0],
    });
    expect(mockParams.commit).toHaveBeenCalledTimes(1);
  });

  it('handles batch insert of many items', () => {
    const mockParams = createMockReplicateParams();
    initializeReplicateParams(mockParams);

    // Create 100 items
    const items = Array.from({ length: 100 }, (_, i) => ({
      id: `${i}`,
      title: `Task ${i}`,
    }));

    replicateInsert(items);

    expect(mockParams.begin).toHaveBeenCalledTimes(1);
    expect(mockParams.write).toHaveBeenCalledTimes(100);
    expect(mockParams.commit).toHaveBeenCalledTimes(1);
  });

  it('handles replicateParams.write throwing error', () => {
    const mockParams = createMockReplicateParams();
    mockParams.write.mockImplementation(() => {
      throw new Error('Write failed');
    });

    initializeReplicateParams(mockParams);

    expect(() => replicateInsert([{ id: '1', title: 'Test' }])).toThrow('Write failed');
  });
});
