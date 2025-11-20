import { Effect, Context, Layer, Data } from 'effect';
import { IDBService } from './IDBService';
import type { ConvexClient } from 'convex/browser';
import { type IDBError, type IDBWriteError, NetworkError } from '../errors';

export class ProtocolMismatchError extends Data.TaggedError('ProtocolMismatchError')<{
  storedVersion: number;
  serverVersion: number;
}> {}

// Service definition
export class ProtocolService extends Context.Tag('ProtocolService')<
  ProtocolService,
  {
    readonly getStoredVersion: () => Effect.Effect<number, IDBError>;
    readonly setStoredVersion: (version: number) => Effect.Effect<void, IDBWriteError>;
    readonly getServerVersion: () => Effect.Effect<number, NetworkError>;
    readonly runMigration: () => Effect.Effect<
      void,
      ProtocolMismatchError | IDBError | IDBWriteError | NetworkError
    >;
  }
>() {}

// Service implementation
export const ProtocolServiceLive = (convexClient: ConvexClient, api: any) =>
  Layer.effect(
    ProtocolService,
    Effect.gen(function* (_) {
      const idb = yield* _(IDBService);

      return ProtocolService.of({
        getStoredVersion: () =>
          Effect.gen(function* (_) {
            const stored = yield* _(idb.get<number>('protocolVersion'));
            return stored ?? 1; // Default to v1
          }),

        setStoredVersion: (version) => idb.set('protocolVersion', version),

        getServerVersion: () =>
          Effect.tryPromise({
            try: () => convexClient.query(api.getProtocolVersion, {}),
            catch: (cause) =>
              new NetworkError({
                operation: 'getProtocolVersion',
                retryable: true,
                cause,
              }),
          }).pipe(
            Effect.map((response: any) => response.protocolVersion),
            Effect.timeout('5 seconds'),
            Effect.catchTag('TimeoutException', () =>
              Effect.fail(
                new NetworkError({
                  operation: 'getProtocolVersion',
                  retryable: true,
                  cause: new Error('Operation timed out after 5 seconds'),
                })
              )
            )
          ),

        runMigration: () =>
          Effect.gen(function* (_) {
            const stored = yield* _(idb.get<number>('protocolVersion'));
            const storedVersion = stored ?? 1; // Default to v1

            const serverResponse = yield* _(
              Effect.tryPromise({
                try: () => convexClient.query(api.getProtocolVersion, {}),
                catch: (cause) =>
                  new NetworkError({
                    operation: 'getProtocolVersion',
                    retryable: true,
                    cause,
                  }),
              }).pipe(
                Effect.timeout('5 seconds'),
                Effect.catchTag('TimeoutException', () =>
                  Effect.fail(
                    new NetworkError({
                      operation: 'getProtocolVersion',
                      retryable: true,
                      cause: new Error('Operation timed out after 5 seconds'),
                    })
                  )
                )
              )
            );
            const serverVersion = (serverResponse as any).protocolVersion ?? 1;

            if (storedVersion < serverVersion) {
              yield* _(
                Effect.logInfo('Running protocol migration', {
                  from: storedVersion,
                  to: serverVersion,
                })
              );

              // Sequential migrations
              for (let version = storedVersion + 1; version <= serverVersion; version++) {
                yield* _(Effect.logInfo(`Migrating to protocol v${version}`));

                // Migration logic per version
                if (version === 2) {
                  yield* _(migrateV1toV2());
                }
                // Future versions here
              }

              yield* _(idb.set('protocolVersion', serverVersion));
              yield* _(
                Effect.logInfo('Protocol migration completed', {
                  newVersion: serverVersion,
                })
              );
            } else {
              yield* _(
                Effect.logDebug('Protocol version up to date', {
                  version: storedVersion,
                })
              );
            }
          }),
      });
    })
  );

// Migration functions
const migrateV1toV2 = () =>
  Effect.gen(function* (_) {
    yield* _(Effect.logInfo('Running v1→v2 migration'));
    // Migration logic here (placeholder for future)
  });
