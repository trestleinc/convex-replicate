/**
 * Generic singleton management for ConvexRx instances.
 *
 * Ensures only one database connection and replication state per table,
 * preventing race conditions during framework re-renders and HMR.
 *
 * Framework-agnostic - works with React, Svelte, Vue, etc.
 */

/**
 * Singleton entry tracking both promise and resolved instance
 */
interface SingletonEntry<TInstance> {
  promise: Promise<TInstance>;
  resolved: TInstance | null;
  isCleaningUp?: boolean;
}

/**
 * Global map of singleton instances, keyed by unique identifier
 */
const singletonInstances = new Map<string, SingletonEntry<any>>();

/**
 * Configuration for singleton management
 */
export interface SingletonConfig<TConfig, TInstance> {
  /** Function to generate unique key from config */
  keyFn: (config: TConfig) => string;
  /** Factory function to create new instance */
  createFn: (config: TConfig) => Promise<TInstance>;
}

/**
 * Get or create a singleton instance.
 * Returns existing instance if available, otherwise creates new one.
 *
 * This is the primary API for framework packages to use.
 *
 * @param config - Configuration for creating the instance
 * @param singleton - Singleton configuration with key and create functions
 * @returns Promise resolving to the singleton instance
 *
 * @example
 * ```typescript
 * const instance = await getSingletonInstance(config, {
 *   keyFn: (cfg) => `${cfg.databaseName}_${cfg.collectionName}`,
 *   createFn: createConvexRx,
 * });
 * ```
 */
export async function getSingletonInstance<TConfig, TInstance>(
  config: TConfig,
  singleton: SingletonConfig<TConfig, TInstance>
): Promise<TInstance> {
  const key = singleton.keyFn(config);

  // Check if instance already exists
  const existing = singletonInstances.get(key);
  if (existing) {
    // Prevent access during cleanup to avoid race conditions
    if (existing.isCleaningUp) {
      throw new Error(
        `Cannot access singleton instance '${key}' while cleanup is in progress. ` +
          `Please wait for cleanup to complete before creating a new instance.`
      );
    }

    // If already resolved, return immediately
    if (existing.resolved) {
      return existing.resolved;
    }
    // Otherwise wait for the promise to resolve
    return existing.promise;
  }

  // Create new instance
  const promise = singleton.createFn(config);

  // Store promise immediately to prevent race conditions
  const entry: SingletonEntry<TInstance> = {
    promise,
    resolved: null,
  };
  singletonInstances.set(key, entry);

  // Wait for resolution and cache result
  try {
    const resolved = await promise;
    entry.resolved = resolved;
    return resolved;
  } catch (error) {
    // Remove failed instance from cache
    singletonInstances.delete(key);
    throw error;
  }
}

/**
 * Mark a singleton instance as cleaning up to prevent race conditions.
 * Call this before starting cleanup operations.
 *
 * @param key - Unique key for the singleton instance
 */
export function markSingletonAsCleaningUp(key: string): void {
  const existing = singletonInstances.get(key);
  if (existing) {
    existing.isCleaningUp = true;
  }
}

/**
 * Remove a singleton instance from the cache by key.
 * Used during cleanup/purge operations.
 *
 * @param key - Unique key for the singleton instance
 */
export function removeSingletonInstance(key: string): void {
  singletonInstances.delete(key);
}

/**
 * Check if a singleton instance exists.
 *
 * @param key - Unique key for the singleton instance
 * @returns True if instance exists
 */
export function hasSingletonInstance(key: string): boolean {
  return singletonInstances.has(key);
}

/**
 * Clear all singleton instances.
 * Primarily for testing/debugging.
 */
export function clearAllSingletons(): void {
  singletonInstances.clear();
}

/**
 * Utility to create a standard key from database and collection names.
 * Convenience helper for common use case.
 *
 * @param databaseName - Database name
 * @param collectionName - Collection/table name
 * @returns Unique key string
 */
export function createSingletonKey(databaseName: string, collectionName: string): string {
  return `${databaseName}_${collectionName}`;
}
