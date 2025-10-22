/**
 * Factory function for creating ConvexRx sync instances.
 *
 * Creates a TanStack DB collection wrapper around RxDB with Convex sync.
 * This is an internal function - users should use useConvexRx hook instead.
 */

import { type ConvexRxDBConfig, createConvexRxDB } from '@convex-rx/core';
import { createCollection } from '@tanstack/react-db';
import { rxdbCollectionOptions } from '@tanstack/rxdb-db-collection';
import type { ConvexRxInstance, SyncedDocument } from './types';

/**
 * Creates a ConvexRx instance with TanStack DB integration.
 * Uses RxDB's native replication wrapped with TanStack DB for React.
 *
 * @param config - Convex RxDB configuration
 * @returns Promise resolving to sync instance with TanStack collection
 * @internal
 */
export async function createConvexRx<TData extends SyncedDocument>(
	config: ConvexRxDBConfig<TData>,
): Promise<ConvexRxInstance<TData>> {
	// 1. Create RxDB database with Convex replication
	const { rxDatabase, rxCollection, replicationState, cleanup } = await createConvexRxDB<TData>(config);

	// 2. Wrap with TanStack DB using rxdbCollectionOptions
	// This is the magic that makes RxDB reactive in React!
	// Note: RxDB collections always use string keys, so TKey = string
	const tanStackCollection = createCollection(
		rxdbCollectionOptions({
			rxCollection,
			startSync: true, // Immediately start syncing RxDB → TanStack DB
		}),
	);

	// Return instance with both TanStack and RxDB access
	return {
		collection: tanStackCollection,
		rxCollection,
		database: rxDatabase,
		replicationState,
		cleanup,
	};
}
