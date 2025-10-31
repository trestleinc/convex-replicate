/**
 * Server-Side Rendering (SSR) Utilities
 *
 * This module provides utilities for loading collection data during
 * server-side rendering. Use `loadCollection` with an explicit config
 * object for clarity and type safety.
 *
 * @module ssr
 * @example
 * ```typescript
 * import { loadCollection } from '@convex-replicate/core/ssr';
 * import { api } from '../convex/_generated/api';
 *
 * const tasks = await loadCollection<Task>(httpClient, {
 *   api: api.tasks,
 *   collection: 'tasks',
 *   limit: 100,
 * });
 * ```
 */

import type { ConvexHttpClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';

/**
 * API module shape expected by loadCollection.
 *
 * This should match the generated API module for your collection
 * (e.g., api.tasks, api.users, etc.)
 */
export type CollectionAPI = {
  pullChanges: FunctionReference<'query', 'public' | 'internal'>;
};

/**
 * Configuration for loading collection data during SSR.
 */
export interface LoadCollectionConfig {
  /** The API module for the collection (e.g., api.tasks) */
  api: CollectionAPI;
  /** The collection name (should match the API module name) */
  collection: string;
  /** Maximum number of items to load (default: 100) */
  limit?: number;
}

/**
 * Load collection data for server-side rendering.
 *
 * This function provides a clean, explicit API for loading initial data
 * from Convex during SSR. All configuration is passed in a single object
 * to make the intent clear and avoid parameter confusion.
 *
 * @param httpClient - Convex HTTP client for server-side queries
 * @param config - Configuration object with api, collection, and options
 * @returns Promise resolving to array of items from the collection
 *
 * @example
 * ```typescript
 * import { loadCollection } from '@convex-replicate/core/ssr';
 * import { api } from '../convex/_generated/api';
 *
 * const tasks = await loadCollection<Task>(httpClient, {
 *   api: api.tasks,
 *   collection: 'tasks',
 *   limit: 100,
 * });
 * ```
 */
export async function loadCollection<TItem extends { id: string }>(
  httpClient: ConvexHttpClient,
  config: LoadCollectionConfig
): Promise<ReadonlyArray<TItem>> {
  const result = await httpClient.query(config.api.pullChanges as any, {
    collectionName: config.collection,
    checkpoint: { lastModified: 0 },
    limit: config.limit ?? 100,
  });

  const items: TItem[] = [];
  for (const change of result.changes) {
    const item = { id: change.documentId, ...change.document } as TItem;
    items.push(item);
  }

  return items;
}
