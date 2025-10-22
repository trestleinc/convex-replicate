import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { wrappedKeyCompressionStorage } from 'rxdb/plugins/key-compression';
import { getRxStorageLocalstorage } from 'rxdb/plugins/storage-localstorage';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import type { RxStorage } from 'rxdb';
import { z } from 'zod';

/**
 * Available storage types for convex-rx.
 *
 * Performance characteristics (browser):
 * - DEXIE: 5-10x faster than localstorage (recommended for production)
 * - LOCALSTORAGE: Slower but simple (legacy support)
 * - MEMORY: Fastest but ephemeral (testing only)
 */
export enum StorageType {
  /** IndexedDB via Dexie.js - Fast, persistent (recommended) */
  DEXIE = 'dexie',
  /** LocalStorage - Simple, persistent (legacy, slower) */
  LOCALSTORAGE = 'localstorage',
  /** In-memory - Fast, ephemeral (testing only) */
  MEMORY = 'memory',
}

/**
 * Zod schema for validating storage type.
 */
export const storageTypeSchema = z.nativeEnum(StorageType);

/**
 * Storage configuration options.
 */
export interface StorageConfig {
  /**
   * Storage type to use.
   *
   * @default StorageType.DEXIE - Recommended for production (IndexedDB via Dexie.js)
   *
   * Options:
   * - StorageType.DEXIE: Fast IndexedDB storage (5-10x faster than localstorage)
   * - StorageType.LOCALSTORAGE: Simple key-value storage (legacy, slower)
   * - StorageType.MEMORY: In-memory only (testing, data lost on reload)
   */
  type?: StorageType;

  /**
   * Custom RxStorage instance for advanced use cases.
   * If provided, overrides the 'type' option.
   *
   * Use this for:
   * - Premium RxDB storage adapters (OPFS, IndexedDB Premium)
   * - Custom storage implementations
   * - Special requirements (encryption, compression layers)
   */
  customStorage?: RxStorage<any, any>;
}

/**
 * Get RxDB storage instance based on configuration.
 * Wraps with key compression and validation layers for optimal performance and schema enforcement.
 *
 * Wrapper order: base storage → key compression → validation
 * This order is required when using keyCompression: true in schemas.
 *
 * @param config - Storage configuration
 * @returns Configured RxStorage instance
 *
 * @example
 * // Use default (Dexie.js with key compression and validation)
 * const storage = getStorage();
 *
 * @example
 * // Use LocalStorage for backward compatibility
 * const storage = getStorage({ type: StorageType.LOCALSTORAGE });
 *
 * @example
 * // Use custom storage
 * import { getRxStorageIndexedDB } from 'rxdb-premium/plugins/storage-indexeddb';
 * const storage = getStorage({
 *   customStorage: getRxStorageIndexedDB()
 * });
 */
export function getStorage(config: StorageConfig = {}): RxStorage<any, any> {
  // Get base storage
  let baseStorage: RxStorage<any, any>;

  if (config.customStorage) {
    baseStorage = config.customStorage;
  } else {
    // Get base storage by type
    const type = config.type || StorageType.DEXIE; // Default to Dexie.js

    // Validate storage type with Zod
    const validatedType = storageTypeSchema.parse(type);

    switch (validatedType) {
      case StorageType.DEXIE:
        baseStorage = getRxStorageDexie();
        break;
      case StorageType.LOCALSTORAGE:
        baseStorage = getRxStorageLocalstorage();
        break;
      case StorageType.MEMORY:
        baseStorage = getRxStorageMemory();
        break;
    }
  }

  // Wrap with key compression (required for keyCompression: true in schemas)
  const storageWithKeyCompression = wrappedKeyCompressionStorage({
    storage: baseStorage,
  });

  // Wrap with validation (final layer)
  return wrappedValidateAjvStorage({
    storage: storageWithKeyCompression,
  });
}

// Re-export storage getters for advanced users
export { getRxStorageDexie, getRxStorageLocalstorage, getRxStorageMemory };
