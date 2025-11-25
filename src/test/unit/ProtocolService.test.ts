import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import {
  ProtocolService,
  ProtocolServiceLive,
  ProtocolMismatchError,
} from '../../client/services/ProtocolService.js';
import { IDBService } from '../../client/services/IDBService.js';

// Mock IDB Service for testing
function createMockIDBService(storage: Map<string, unknown> = new Map()) {
  return IDBService.of({
    get: <T>(key: string) => Effect.sync(() => storage.get(key) as T | undefined),
    set: (key: string, value: unknown) =>
      Effect.sync(() => {
        storage.set(key, value);
      }),
    delete: (key: string) =>
      Effect.sync(() => {
        storage.delete(key);
      }),
    clear: () =>
      Effect.sync(() => {
        storage.clear();
      }),
  });
}

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
  let storage: Map<string, unknown>;
  let mockConvexClient: ReturnType<typeof createMockConvexClient>;
  const mockApi = { protocol: 'api.protocol' };

  beforeEach(() => {
    storage = new Map();
    mockConvexClient = createMockConvexClient();
  });

  function createTestLayer() {
    return ProtocolServiceLive(mockConvexClient as any, mockApi).pipe(
      Layer.provide(Layer.succeed(IDBService, createMockIDBService(storage)))
    );
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
        storage.set('protocolVersion', 3);

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
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
          }).pipe(Effect.provide(createTestLayer()))
        );

        expect(storage.get('protocolVersion')).toBe(5);
      });

      it('overwrites existing version', async () => {
        storage.set('protocolVersion', 2);

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.setStoredVersion(4);
          }).pipe(Effect.provide(createTestLayer()))
        );

        expect(storage.get('protocolVersion')).toBe(4);
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
          }).pipe(
            Effect.provide(
              ProtocolServiceLive(mockConvexClient as any, mockApi).pipe(
                Layer.provide(Layer.succeed(IDBService, createMockIDBService(storage)))
              )
            )
          )
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
            Effect.provide(
              ProtocolServiceLive(mockConvexClient as any, mockApi).pipe(
                Layer.provide(Layer.succeed(IDBService, createMockIDBService(storage)))
              )
            ),
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
        storage.set('protocolVersion', 1);
        mockConvexClient = createMockConvexClient({ protocolVersion: 1 });

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.runMigration();
          }).pipe(
            Effect.provide(
              ProtocolServiceLive(mockConvexClient as any, mockApi).pipe(
                Layer.provide(Layer.succeed(IDBService, createMockIDBService(storage)))
              )
            )
          )
        );

        // Version should remain unchanged
        expect(storage.get('protocolVersion')).toBe(1);
      });

      it('runs migration when stored < server', async () => {
        storage.set('protocolVersion', 1);
        mockConvexClient = createMockConvexClient({ protocolVersion: 2 });

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.runMigration();
          }).pipe(
            Effect.provide(
              ProtocolServiceLive(mockConvexClient as any, mockApi).pipe(
                Layer.provide(Layer.succeed(IDBService, createMockIDBService(storage)))
              )
            )
          )
        );

        // Version should be updated
        expect(storage.get('protocolVersion')).toBe(2);
      });

      it('stores new version after migration', async () => {
        // Start with no stored version
        mockConvexClient = createMockConvexClient({ protocolVersion: 3 });

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.runMigration();
          }).pipe(
            Effect.provide(
              ProtocolServiceLive(mockConvexClient as any, mockApi).pipe(
                Layer.provide(Layer.succeed(IDBService, createMockIDBService(storage)))
              )
            )
          )
        );

        expect(storage.get('protocolVersion')).toBe(3);
      });

      it('handles migration from v1 to v2', async () => {
        storage.set('protocolVersion', 1);
        mockConvexClient = createMockConvexClient({ protocolVersion: 2 });

        // Should not throw
        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.runMigration();
          }).pipe(
            Effect.provide(
              ProtocolServiceLive(mockConvexClient as any, mockApi).pipe(
                Layer.provide(Layer.succeed(IDBService, createMockIDBService(storage)))
              )
            )
          )
        );

        expect(storage.get('protocolVersion')).toBe(2);
      });

      it('runs incremental migrations for multiple versions', async () => {
        storage.set('protocolVersion', 1);
        mockConvexClient = createMockConvexClient({ protocolVersion: 3 });

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.runMigration();
          }).pipe(
            Effect.provide(
              ProtocolServiceLive(mockConvexClient as any, mockApi).pipe(
                Layer.provide(Layer.succeed(IDBService, createMockIDBService(storage)))
              )
            )
          )
        );

        // Should reach the final version
        expect(storage.get('protocolVersion')).toBe(3);
      });

      it('fails with NetworkError when server query fails', async () => {
        mockConvexClient = createMockConvexClient({ shouldThrow: true });

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            return yield* svc.runMigration();
          }).pipe(
            Effect.provide(
              ProtocolServiceLive(mockConvexClient as any, mockApi).pipe(
                Layer.provide(Layer.succeed(IDBService, createMockIDBService(storage)))
              )
            ),
            Effect.either
          )
        );

        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left._tag).toBe('NetworkError');
        }
      });

      it('does not change version when stored >= server', async () => {
        storage.set('protocolVersion', 3);
        mockConvexClient = createMockConvexClient({ protocolVersion: 2 });

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* ProtocolService;
            yield* svc.runMigration();
          }).pipe(
            Effect.provide(
              ProtocolServiceLive(mockConvexClient as any, mockApi).pipe(
                Layer.provide(Layer.succeed(IDBService, createMockIDBService(storage)))
              )
            )
          )
        );

        // Version should remain at the higher stored version
        expect(storage.get('protocolVersion')).toBe(3);
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
