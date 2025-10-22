import { type ConvexRxDBConfig, type ConvexRxDocument, createConvexRxDB } from '@convex-rx/core';
import { type Collection, createCollection } from '@tanstack/react-db';
import { rxdbCollectionOptions } from '@tanstack/rxdb-db-collection';
import type { RxCollection, RxDatabase } from 'rxdb';

/**
 * Instance returned by createReactConvexRx containing TanStack DB collection and RxDB primitives
 */
export interface ReactConvexRxInstance<T extends ConvexRxDocument = any> {
  /** TanStack DB collection - reactive wrapper around RxDB */
  collection: Collection<T, string | number, any>;
  /** Underlying RxDB collection */
  rxCollection: RxCollection<T>;
  /** RxDB database instance */
  rxDatabase: RxDatabase;
  /** RxDB replication state with observables (error$, active$, received$, sent$) */
  replicationState: any;
  /** Cleanup function to cancel replication and remove database */
  cleanup: () => Promise<void>;
}

/**
 * Creates a React ConvexRx instance with TanStack DB integration.
 * This uses RxDB's native replication wrapped with TanStack DB for React.
 *
 * @param config - Convex RxDB configuration
 * @returns Promise resolving to sync instance with TanStack collection
 */
export async function createReactConvexRx<T extends ConvexRxDocument>(
  config: ConvexRxDBConfig<T>
): Promise<ReactConvexRxInstance<T>> {
  // 1. Create RxDB database with Convex replication
  const { rxDatabase, rxCollection, replicationState, cleanup } = await createConvexRxDB<T>(config);

  // 2. Wrap with TanStack DB using rxdbCollectionOptions
  // This is the magic that makes RxDB reactive in React!
  const tanStackCollection = createCollection(
    rxdbCollectionOptions({
      rxCollection,
      startSync: true, // Immediately start syncing RxDB → TanStack DB
    })
  ) as Collection<T, string | number, any>;

  // Return instance with both TanStack and RxDB access
  return {
    collection: tanStackCollection,
    rxCollection,
    rxDatabase,
    replicationState,
    cleanup,
  };
}
