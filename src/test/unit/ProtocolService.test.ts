import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { del as idbDel } from 'idb-keyval';
import {
  ProtocolService,
  ProtocolServiceLive,
  ProtocolMismatchError,
} from '../../client/services/ProtocolService.js';

// Mock Convex Client
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

describe('ProtocolService', () => {
  let mockConvexClient: ReturnType<typeof createMockConvexClient>;
  const mockApi = { protocol: 'api.protocol' };

  beforeEach(async () => {
    // Clear protocol version from IndexedDB before each test
    await idbDel('protocolVersion');
    mockConvexClient = createMockConvexClient();
  });

  function createTestLayer() {
    // ProtocolServiceLive now uses idb-keyval directly - no IDBService dependency
    return ProtocolServiceLive(mockConvexClient as any, mockApi);
  }

  // ============================================
  // VERSION STORAGE
  // ============================================
  describe('Version Storage', () => {
    describe('getStoredVersion', () => {
      it('returns 1 when no version is stored', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            const version = yield* svc.getStoredVersion();
            expect(version).toBe(1);
          }).pipe(Effect.provide(createTestLayer()))
        );
      });

      it('returns the stored version when one exists', async () => {
        // Set version via setStoredVersion first
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.setStoredVersion(3);
            const version = yield* svc.getStoredVersion();
            expect(version).toBe(3);
          }).pipe(Effect.provide(createTestLayer()))
        );
      });
    });

    describe('setStoredVersion', () => {
      it('stores the version in IDB', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.setStoredVersion(5);
            const version = yield* svc.getStoredVersion();
            expect(version).toBe(5);
          }).pipe(Effect.provide(createTestLayer()))
        );
      });

      it('overwrites existing version', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.setStoredVersion(2);
            yield* svc.setStoredVersion(4);
            const version = yield* svc.getStoredVersion();
            expect(version).toBe(4);
          }).pipe(Effect.provide(createTestLayer()))
        );
      });
    });
  });

  // ============================================
  // SERVER VERSION
  // ============================================
  describe('Server Version', () => {
    describe('getServerVersion', () => {
      it('fetches version from server', async () => {
        mockConvexClient = createMockConvexClient({ protocolVersion: 2 });

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            const version = yield* svc.getServerVersion();
            expect(version).toBe(2);
          }).pipe(Effect.provide(ProtocolServiceLive(mockConvexClient as any, mockApi)))
        );

        expect(mockConvexClient.query).toHaveBeenCalledWith(mockApi.protocol, {});
      });

      it('fails with NetworkError on network failure', async () => {
        mockConvexClient = createMockConvexClient({ shouldThrow: true });

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            return yield* svc.getServerVersion();
          }).pipe(
            Effect.provide(ProtocolServiceLive(mockConvexClient as any, mockApi)),
            Effect.either
          )
        );

        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left._tag).toBe('NetworkError');
        }
      });
    });
  });

  // ============================================
  // MIGRATION
  // ============================================
  describe('Migration', () => {
    describe('runMigration', () => {
      it('skips migration when versions match', async () => {
        mockConvexClient = createMockConvexClient({ protocolVersion: 1 });

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.setStoredVersion(1);
            yield* svc.runMigration();
            const version = yield* svc.getStoredVersion();
            // Version should remain unchanged
            expect(version).toBe(1);
          }).pipe(Effect.provide(ProtocolServiceLive(mockConvexClient as any, mockApi)))
        );
      });

      it('runs migration when stored < server', async () => {
        mockConvexClient = createMockConvexClient({ protocolVersion: 2 });

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.setStoredVersion(1);
            yield* svc.runMigration();
            const version = yield* svc.getStoredVersion();
            // Version should be updated
            expect(version).toBe(2);
          }).pipe(Effect.provide(ProtocolServiceLive(mockConvexClient as any, mockApi)))
        );
      });

      it('stores new version after migration', async () => {
        mockConvexClient = createMockConvexClient({ protocolVersion: 3 });

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            // Start with no stored version (defaults to 1)
            yield* svc.runMigration();
            const version = yield* svc.getStoredVersion();
            expect(version).toBe(3);
          }).pipe(Effect.provide(ProtocolServiceLive(mockConvexClient as any, mockApi)))
        );
      });

      it('handles migration from v1 to v2', async () => {
        mockConvexClient = createMockConvexClient({ protocolVersion: 2 });

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.setStoredVersion(1);
            yield* svc.runMigration();
            const version = yield* svc.getStoredVersion();
            expect(version).toBe(2);
          }).pipe(Effect.provide(ProtocolServiceLive(mockConvexClient as any, mockApi)))
        );
      });

      it('runs incremental migrations for multiple versions', async () => {
        mockConvexClient = createMockConvexClient({ protocolVersion: 3 });

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.setStoredVersion(1);
            yield* svc.runMigration();
            const version = yield* svc.getStoredVersion();
            // Should reach the final version
            expect(version).toBe(3);
          }).pipe(Effect.provide(ProtocolServiceLive(mockConvexClient as any, mockApi)))
        );
      });

      it('fails with NetworkError when server query fails', async () => {
        mockConvexClient = createMockConvexClient({ shouldThrow: true });

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            return yield* svc.runMigration();
          }).pipe(
            Effect.provide(ProtocolServiceLive(mockConvexClient as any, mockApi)),
            Effect.either
          )
        );

        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left._tag).toBe('NetworkError');
        }
      });

      it('does not change version when stored >= server', async () => {
        mockConvexClient = createMockConvexClient({ protocolVersion: 2 });

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.setStoredVersion(3);
            yield* svc.runMigration();
            const version = yield* svc.getStoredVersion();
            // Version should remain at the higher stored version
            expect(version).toBe(3);
          }).pipe(Effect.provide(ProtocolServiceLive(mockConvexClient as any, mockApi)))
        );
      });
    });
  });

  // ============================================
  // ERROR HANDLING
  // ============================================
  describe('Error Handling', () => {
    describe('ProtocolMismatchError', () => {
      it('has correct tag', () => {
        const error = new ProtocolMismatchError({
          storedVersion: 1,
          serverVersion: 2,
        });
        expect(error._tag).toBe('ProtocolMismatchError');
      });

      it('contains version information', () => {
        const error = new ProtocolMismatchError({
          storedVersion: 1,
          serverVersion: 3,
        });
        expect(error.storedVersion).toBe(1);
        expect(error.serverVersion).toBe(3);
      });
    });
  });
});
