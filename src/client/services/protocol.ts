import { Effect, Context, Layer, Data } from 'effect';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import type { ConvexClient } from 'convex/browser';
import { IDBError, IDBWriteError, NetworkError } from '$/client/errors.js';

export class ProtocolMismatchError extends Data.TaggedError('ProtocolMismatchError')<{
  storedVersion: number;
  serverVersion: number;
}> {}

export class Protocol extends Context.Tag('Protocol')<
  Protocol,
  {
    readonly getStoredVersion: () => Effect.Effect<number, IDBError>;
    readonly setStoredVersion: (version: number) => Effect.Effect<void, IDBWriteError>;
    readonly getServerVersion: () => Effect.Effect<number, NetworkError>;
    readonly clearStorage: () => Effect.Effect<void, IDBError>;
    readonly runMigration: () => Effect.Effect<
      void,
      ProtocolMismatchError | IDBError | IDBWriteError | NetworkError
    >;
  }
>() {}

export const ProtocolLive = (convexClient: ConvexClient, api: any) =>
  Layer.succeed(
    Protocol,
    Protocol.of({
      getStoredVersion: () =>
        Effect.gen(function* (_) {
          const stored = yield* _(
            Effect.tryPromise({
              try: () => idbGet<number>('protocolVersion'),
              catch: (cause) => new IDBError({ operation: 'get', key: 'protocolVersion', cause }),
            })
          );
          return stored ?? 1;
        }),

      setStoredVersion: (version) =>
        Effect.tryPromise({
          try: () => idbSet('protocolVersion', version),
          catch: (cause) => new IDBWriteError({ key: 'protocolVersion', value: version, cause }),
        }),

      clearStorage: () =>
        Effect.tryPromise({
          try: () => idbDel('protocolVersion'),
          catch: (cause) => new IDBError({ operation: 'delete', key: 'protocolVersion', cause }),
        }),

      getServerVersion: () =>
        Effect.tryPromise({
          try: () => convexClient.query(api.protocol, {}),
          catch: (cause) =>
            new NetworkError({
              operation: 'protocol',
              retryable: true,
              cause,
            }),
        }).pipe(
          Effect.map((response: any) => response.protocolVersion),
          Effect.timeout('5 seconds'),
          Effect.catchTag('TimeoutException', () =>
            Effect.fail(
              new NetworkError({
                operation: 'protocol',
                retryable: true,
                cause: new Error('Operation timed out after 5 seconds'),
              })
            )
          )
        ),

      runMigration: () =>
        Effect.gen(function* (_) {
          const stored = yield* _(
            Effect.tryPromise({
              try: () => idbGet<number>('protocolVersion'),
              catch: (cause) => new IDBError({ operation: 'get', key: 'protocolVersion', cause }),
            })
          );
          const storedVersion = stored ?? 1;

          const serverResponse = yield* _(
            Effect.tryPromise({
              try: () => convexClient.query(api.protocol, {}),
              catch: (cause) =>
                new NetworkError({
                  operation: 'protocol',
                  retryable: true,
                  cause,
                }),
            }).pipe(
              Effect.timeout('5 seconds'),
              Effect.catchTag('TimeoutException', () =>
                Effect.fail(
                  new NetworkError({
                    operation: 'protocol',
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

            for (let version = storedVersion + 1; version <= serverVersion; version++) {
              yield* _(Effect.logInfo(`Migrating to protocol v${version}`));

              if (version === 2) {
                yield* _(migrateV1toV2());
              }
            }

            yield* _(
              Effect.tryPromise({
                try: () => idbSet('protocolVersion', serverVersion),
                catch: (cause) =>
                  new IDBWriteError({ key: 'protocolVersion', value: serverVersion, cause }),
              })
            );
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
    })
  );

const migrateV1toV2 = () =>
  Effect.gen(function* (_) {
    yield* _(Effect.logInfo('Running v1→v2 migration'));
  });

/**
 * Ensures protocol version is checked and migrations are run.
 * This is the primary entry point for protocol initialization.
 */
export const ensureProtocolVersion = (
  convexClient: ConvexClient,
  api: { protocol: any }
): Effect.Effect<number, NetworkError | IDBError | IDBWriteError | ProtocolMismatchError, never> =>
  Effect.gen(function* () {
    const protocol = yield* Protocol;

    // Check and run migration if needed
    yield* protocol.runMigration();

    // Get final version
    const version = yield* protocol.getStoredVersion();

    yield* Effect.logInfo('Protocol version ensured', { version });

    return version;
  }).pipe(
    Effect.provide(ProtocolLive(convexClient, api)),
    Effect.withSpan('protocol.ensure')
  );
