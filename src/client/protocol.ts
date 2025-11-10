/**
 * Protocol Evolution: Local storage migration for ConvexReplicate
 *
 * When the NPM package is updated and the protocol version changes,
 * this migrates local IndexedDB structures to match.
 *
 * Philosophy: Minimal code - leverage IndexedDB primitives
 */

import { createStore, get, set, clear } from 'idb-keyval';
import { getLogger } from './logger.js';

const logger = getLogger(['convex-replicate', 'protocol']);

// IndexedDB database name for protocol metadata
const PROTOCOL_DB_NAME = 'convex-replicate-protocol';
const PROTOCOL_STORE = 'metadata';

/**
 * Get IndexedDB connection for protocol metadata
 */
function getProtocolStore() {
  return createStore(PROTOCOL_DB_NAME, PROTOCOL_STORE);
}

/**
 * Get stored protocol version from IndexedDB
 * Returns 1 for legacy clients (no version stored yet)
 */
export async function getStoredProtocolVersion(): Promise<number> {
  try {
    const version = await get('version', getProtocolStore());
    return version ?? 1; // Default to v1 for legacy clients
  } catch (error) {
    logger.error('Failed to get stored protocol version', { error });
    return 1; // Safe default
  }
}

/**
 * Store protocol version in IndexedDB
 */
export async function storeProtocolVersion(version: number): Promise<void> {
  try {
    await set('version', version, getProtocolStore());
    logger.debug('Protocol version stored', { version });
  } catch (error) {
    logger.error('Failed to store protocol version', { error });
    throw error;
  }
}

/**
 * Run local storage migrations sequentially
 * Example: v1 → v2 → v3
 */
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

/**
 * Run a single migration step
 * Add new migration logic here when protocol changes
 */
async function runMigration(from: number, to: number): Promise<void> {
  if (from === 1 && to === 2) {
    await migrateV1toV2();
  }
  // Future migrations go here:
  // if (from === 2 && to === 3) await migrateV2toV3();
}

/**
 * Example migration: v1 → v2
 * This would add new fields to checkpoints, convert old formats, etc.
 */
async function migrateV1toV2(): Promise<void> {
  logger.info('Migrating v1 to v2 (example - no changes needed yet)');

  // Example: If protocol v2 adds state vector to checkpoints
  // const checkpoints = await getAllCheckpoints();
  // for (const checkpoint of checkpoints) {
  //   await updateCheckpoint(checkpoint.collection, {
  //     ...checkpoint,
  //     vector: null, // v2 field, will compute on next sync
  //   });
  // }

  // For now, v1 to v2 is a no-op (we're still on v1)
}

/**
 * Clear all protocol metadata (useful for testing or reset)
 */
export async function clearProtocolStorage(): Promise<void> {
  try {
    await clear(getProtocolStore());
    logger.info('Protocol storage cleared');
  } catch (error) {
    logger.error('Failed to clear protocol storage', { error });
    throw error;
  }
}

/**
 * Get all protocol metadata (useful for debugging)
 */
export async function getProtocolMetadata(): Promise<Record<string, any>> {
  try {
    const store = getProtocolStore();
    // Note: idb-keyval doesn't have a direct way to get all entries
    // For now, just return the version
    const version = await get('version', store);
    return { version: version ?? 1 };
  } catch (error) {
    logger.error('Failed to get protocol metadata', { error });
    return { version: 1 };
  }
}
