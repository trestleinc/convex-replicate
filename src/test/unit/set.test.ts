import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setReplicate, ensureSet, _resetSetState, getProtocolInfo } from '$/client/set.js';

// Mock ConvexClient
function createMockConvexClient(options?: { protocolVersion?: number; shouldThrow?: boolean }) {
  return {
    query: vi.fn().mockImplementation(() => {
      if (options?.shouldThrow) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ protocolVersion: options?.protocolVersion ?? 1 });
    }),
    mutation: vi.fn(),
    subscribe: vi.fn(),
    onUpdate: vi.fn(),
  };
}

describe('Set Module', () => {
  beforeEach(() => {
    _resetSetState();
  });

  afterEach(() => {
    _resetSetState();
  });

  describe('setReplicate', () => {
    it('throws when no protocol endpoint provided', async () => {
      const mockClient = createMockConvexClient();

      await expect(
        setReplicate({
          convexClient: mockClient as any,
          api: undefined,
        })
      ).rejects.toThrow('No protocol version endpoint provided');
    });

    it('throws when api.protocol is undefined', async () => {
      const mockClient = createMockConvexClient();

      await expect(
        setReplicate({
          convexClient: mockClient as any,
          api: {},
        })
      ).rejects.toThrow('No protocol version endpoint provided');
    });

    it('successfully sets up with valid protocol endpoint', async () => {
      const mockClient = createMockConvexClient({ protocolVersion: 1 });
      const mockProtocol = vi.fn();

      await setReplicate({
        convexClient: mockClient as any,
        api: { protocol: mockProtocol as any },
      });

      // Should have called query with protocol endpoint
      expect(mockClient.query).toHaveBeenCalled();
    });

    it('throws on network error', async () => {
      const mockClient = createMockConvexClient({ shouldThrow: true });
      const mockProtocol = vi.fn();

      await expect(
        setReplicate({
          convexClient: mockClient as any,
          api: { protocol: mockProtocol as any },
        })
      ).rejects.toThrow('Replicate setup failed');
    });
  });

  describe('ensureSet', () => {
    it('returns immediately if already set', async () => {
      const mockClient = createMockConvexClient({ protocolVersion: 1 });
      const mockProtocol = vi.fn();

      // First call sets it up
      await ensureSet({
        convexClient: mockClient as any,
        api: { protocol: mockProtocol as any },
      });

      // Second call should return immediately without calling query again
      const queryCallCount = mockClient.query.mock.calls.length;
      await ensureSet({
        convexClient: mockClient as any,
        api: { protocol: mockProtocol as any },
      });

      expect(mockClient.query.mock.calls.length).toBe(queryCallCount);
    });

    it('only initializes once with concurrent calls', async () => {
      const mockClient = createMockConvexClient({ protocolVersion: 1 });
      const mockProtocol = vi.fn();

      const options = {
        convexClient: mockClient as any,
        api: { protocol: mockProtocol as any },
      };

      // Make concurrent calls
      await Promise.all([ensureSet(options), ensureSet(options), ensureSet(options)]);

      // Should only have initialized once
      expect(mockClient.query.mock.calls.length).toBe(1);
    });

    it('resets promise on failure allowing retry', async () => {
      const mockClient = createMockConvexClient({ shouldThrow: true });
      const mockProtocol = vi.fn();

      // First call fails
      await expect(
        ensureSet({
          convexClient: mockClient as any,
          api: { protocol: mockProtocol as any },
        })
      ).rejects.toThrow();

      // Reset to success
      mockClient.query.mockResolvedValue({ protocolVersion: 1 });

      // Should be able to retry
      await ensureSet({
        convexClient: mockClient as any,
        api: { protocol: mockProtocol as any },
      });

      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('getProtocolInfo', () => {
    it('throws when protocol endpoint not provided', async () => {
      const mockClient = createMockConvexClient();

      await expect(getProtocolInfo(mockClient as any)).rejects.toThrow(
        'Protocol API endpoint required'
      );
    });

    it('returns version information', async () => {
      const mockClient = createMockConvexClient({ protocolVersion: 2 });
      const mockProtocol = vi.fn();

      const info = await getProtocolInfo(mockClient as any, { protocol: mockProtocol as any });

      expect(info).toHaveProperty('serverVersion');
      expect(info).toHaveProperty('localVersion');
      expect(info).toHaveProperty('needsMigration');
      expect(typeof info.serverVersion).toBe('number');
    });

    it('detects when migration is needed', async () => {
      const mockClient = createMockConvexClient({ protocolVersion: 5 });
      const mockProtocol = vi.fn();

      const info = await getProtocolInfo(mockClient as any, { protocol: mockProtocol as any });

      // Server is v5, local starts at v1
      expect(info.serverVersion).toBe(5);
      expect(info.needsMigration).toBe(true);
    });
  });
});
