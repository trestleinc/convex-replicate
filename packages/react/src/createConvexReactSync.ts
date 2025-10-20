import {
  type ConvexRxSyncInstance,
  type ConvexSyncConfig,
  createConvexRxSync,
} from '@convex-rx/core';
import { createCollection } from '@tanstack/react-db';
import { rxdbCollectionOptions } from '@tanstack/rxdb-db-collection';

// Extended instance type that includes TanStack collection
export interface ConvexReactSyncInstance<T> extends ConvexRxSyncInstance<T> {
  collection: any; // TanStack DB collection
}

/**
 * Creates a Convex sync instance with TanStack React DB integration.
 * This wraps the core RxDB sync with React-specific TanStack collections.
 *
 * @param config - Convex sync configuration
 * @returns Promise resolving to sync instance with TanStack collection
 */
export async function createConvexReactSync<T>(
  config: ConvexSyncConfig<T>
): Promise<ConvexReactSyncInstance<T>> {
  // Create the core RxDB sync instance
  const coreInstance = await createConvexRxSync<T>(config);

  // Wrap RxDB collection with TanStack DB for React integration
  const tanStackCollection = createCollection(
    rxdbCollectionOptions({
      rxCollection: coreInstance.rxCollection,
      startSync: true, // Start syncing immediately
    })
  );

  // Return extended instance with TanStack collection
  return {
    ...coreInstance,
    collection: tanStackCollection,
  };
}
