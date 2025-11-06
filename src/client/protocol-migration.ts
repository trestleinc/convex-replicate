/**
 * Protocol Evolution: Local storage migration for ConvexReplicate
 *
 * When the NPM package is updated and the protocol version changes,
 * this migrates local IndexedDB structures (checkpoints, metadata) to match.
 *
 * Philosophy: Minimal code - leverage IndexedDB primitives
 */

import { getLogger } from './logger.js';

const logger = getLogger(['convex-replicate', 'protocol-migration']);

// IndexedDB database name for protocol metadata
const PROTOCOL_DB_NAME = 'convex-replicate-protocol';
const PROTOCOL_STORE = 'metadata';

/**
 * Get IndexedDB connection for protocol metadata
 */
async function getProtocolDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PROTOCOL_DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(PROTOCOL_STORE)) {
        db.createObjectStore(PROTOCOL_STORE);
      }
    };
  });
}

/**
 * Get stored protocol version from IndexedDB
 * Returns 1 for legacy clients (no version stored yet)
 */
export async function getStoredProtocolVersion(): Promise<number> {
  try {
    const db = await getProtocolDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PROTOCOL_STORE, 'readonly');
      const store = tx.objectStore(PROTOCOL_STORE);
      const request = store.get('version');

      request.onsuccess = () => {
        const version = request.result as number | undefined;
        resolve(version ?? 1); // Default to v1 for legacy clients
      };
      request.onerror = () => reject(request.error);
    });
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
    const db = await getProtocolDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PROTOCOL_STORE, 'readwrite');
      const store = tx.objectStore(PROTOCOL_STORE);
      const request = store.put(version, 'version');

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
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
  //   await updateCheckpoint(checkpoint.collectionName, {
  //     ...checkpoint,
  //     stateVector: null, // v2 field, will compute on next sync
  //   });
  // }

  // For now, v1 to v2 is a no-op (we're still on v1)
}
