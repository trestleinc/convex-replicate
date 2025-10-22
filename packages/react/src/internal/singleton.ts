/**
 * Internal singleton management for ConvexRx instances.
 *
 * Ensures only one database connection and replication state per table,
 * preventing race conditions during React re-renders and HMR.
 */

import type { ConvexRxDBConfig } from '@convex-rx/core';
import type { ConvexRxInstance, SyncedDocument } from '../types';

/**
 * Singleton entry tracking both promise and resolved instance
 */
interface SingletonEntry<TData extends SyncedDocument> {
	promise: Promise<ConvexRxInstance<TData>>;
	resolved: ConvexRxInstance<TData> | null;
}

/**
 * Global map of singleton instances, keyed by database + table name
 */
const singletonInstances = new Map<string, SingletonEntry<any>>();

/**
 * Generate unique key for singleton instance
 */
function getSingletonKey(databaseName: string, tableName: string): string {
	return `${databaseName}_${tableName}`;
}

/**
 * Get or create a singleton instance for a table.
 * Returns existing instance if available, otherwise creates new one.
 *
 * @param config - Configuration for creating the instance
 * @param createFn - Factory function to create new instance
 * @returns Promise resolving to the singleton instance
 */
export async function getSingletonInstance<TData extends SyncedDocument>(
	config: ConvexRxDBConfig<TData>,
	createFn: (config: ConvexRxDBConfig<TData>) => Promise<ConvexRxInstance<TData>>,
): Promise<ConvexRxInstance<TData>> {
	const key = getSingletonKey(config.databaseName, config.collectionName);

	// Check if instance already exists
	const existing = singletonInstances.get(key);
	if (existing) {
		// If already resolved, return immediately
		if (existing.resolved) {
			return existing.resolved;
		}
		// Otherwise wait for the promise to resolve
		return existing.promise;
	}

	// Create new instance
	const promise = createFn(config);

	// Store promise immediately to prevent race conditions
	const entry: SingletonEntry<TData> = {
		promise,
		resolved: null,
	};
	singletonInstances.set(key, entry);

	// Wait for resolution and cache result
	const resolved = await promise;
	entry.resolved = resolved;

	return resolved;
}

/**
 * Remove a singleton instance from the cache.
 * Used during cleanup/purge operations.
 *
 * @param databaseName - Database name
 * @param tableName - Table/collection name
 */
export function removeSingletonInstance(databaseName: string, tableName: string): void {
	const key = getSingletonKey(databaseName, tableName);
	singletonInstances.delete(key);
}

/**
 * Check if a singleton instance exists for a table.
 *
 * @param databaseName - Database name
 * @param tableName - Table/collection name
 * @returns True if instance exists
 */
export function hasSingletonInstance(databaseName: string, tableName: string): boolean {
	const key = getSingletonKey(databaseName, tableName);
	return singletonInstances.has(key);
}

/**
 * Clear all singleton instances.
 * Primarily for testing/debugging.
 */
export function clearAllSingletons(): void {
	singletonInstances.clear();
}
