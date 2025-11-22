import { Effect, Layer, Schema } from 'effect';
import { createStore, get, set, clear } from 'idb-keyval';
import { getLogger } from './logger.js';
import {
  ProtocolService,
  ProtocolServiceLive,
  type ProtocolMismatchError,
} from './services/ProtocolService.js';
import { IDBServiceLive } from './services/IDBService.js';
import {
  ProtocolVersionError,
  type NetworkError,
  type IDBError,
  type IDBWriteError,
} from './errors/index.js';
import type { ConvexClient } from 'convex/browser';

const logger = getLogger(['convex-replicate', 'protocol']);

const PROTOCOL_DB_NAME = 'convex-replicate-protocol';
const PROTOCOL_STORE = 'metadata';

function getProtocolStore() {
  return createStore(PROTOCOL_DB_NAME, PROTOCOL_STORE);
}

export async function getStoredProtocolVersion(): Promise<number> {
  try {
    const version = await get('version', getProtocolStore());
    return version ?? 1;
  } catch (error) {
    logger.error('Failed to get stored protocol version', { error });
    return 1;
  }
}

export async function storeProtocolVersion(version: number): Promise<void> {
  try {
    await set('version', version, getProtocolStore());
    logger.debug('Protocol version stored', { version });
  } catch (error) {
    logger.error('Failed to store protocol version', { error });
    throw error;
  }
}

export async function migrateLocalStorage(fromVersion: number, toVersion: number): Promise<void> {
  let currentVersion = fromVersion;

  while (currentVersion < toVersion) {
    const nextVersion = currentVersion + 1;
    logger.info('Running local storage migration', {
      from: currentVersion,
      to: nextVersion,
    });

    await runMigration(currentVersion, nextVersion);
    currentVersion = nextVersion;
  }

  logger.info('Local storage migration complete', { toVersion });
}

async function runMigration(from: number, to: number): Promise<void> {
  if (from === 1 && to === 2) {
    await migrateV1toV2();
  }
}

async function migrateV1toV2(): Promise<void> {
  logger.info('Migrating v1 to v2 (example - no changes needed yet)');
}

export async function clearProtocolStorage(): Promise<void> {
  try {
    await clear(getProtocolStore());
    logger.info('Protocol storage cleared');
  } catch (error) {
    logger.error('Failed to clear protocol storage', { error });
    throw error;
  }
}

export async function getProtocolMetadata(): Promise<Record<string, any>> {
  try {
    const store = getProtocolStore();
    const version = await get('version', store);
    return { version: version ?? 1 };
  } catch (error) {
    logger.error('Failed to get protocol metadata', { error });
    return { version: 1 };
  }
}

export const ProtocolVersion = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
  Schema.lessThanOrEqualTo(99),
  Schema.annotations({
    description: 'Valid protocol version (1-99)',
  })
);

export type ProtocolVersion = Schema.Schema.Type<typeof ProtocolVersion>;

export const validateProtocolVersion = (version: unknown) =>
  Schema.decodeUnknown(ProtocolVersion)(version).pipe(
    Effect.mapError(
      (_error) =>
        new ProtocolVersionError({
          expected: 1,
          actual: typeof version === 'number' ? version : 0,
          canMigrate: false,
        })
    )
  );
export const ensureProtocolVersion = (
  convexClient: ConvexClient,
  api: { getProtocolVersion: any }
): Effect.Effect<number, NetworkError | IDBError | IDBWriteError | ProtocolMismatchError, never> =>
  Effect.gen(function* () {
    const protocol = yield* ProtocolService;

    // Check and run migration if needed
    yield* protocol.runMigration();

    // Get final version
    const version = yield* protocol.getStoredVersion();

    yield* Effect.logInfo('Protocol version ensured', { version });

    return version;
  }).pipe(
    Effect.provide(Layer.provide(ProtocolServiceLive(convexClient, api), IDBServiceLive)),
    Effect.withSpan('protocol.ensure')
  );
