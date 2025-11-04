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
 * **IMPORTANT**: This function is currently limited because `pullChanges` only returns
 * CRDT bytes, not materialized documents. For most SSR use cases, it's recommended to
 * create a separate query that reads from your main table instead.
 *
 * @deprecated Consider creating a dedicated SSR query instead. See example below.
 *
 * @param httpClient - Convex HTTP client for server-side queries
 * @param config - Configuration object with api, collection, and options
 * @returns Promise resolving to array of items from the collection
 *
 * @example
 * **Recommended SSR Pattern:**
 * ```typescript
 * // convex/tasks.ts
 * export const getTasks = query({
 *   handler: async (ctx) => {
 *     return await ctx.db
 *       .query('tasks')
 *       .filter((q) => q.neq(q.field('deleted'), true))
 *       .collect();
 *   },
 * });
 *
 * // In your route loader
 * import { ConvexHttpClient } from 'convex/browser';
 * import { api } from '../convex/_generated/api';
 *
 * const httpClient = new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL);
 * const tasks = await httpClient.query(api.tasks.getTasks);
 * ```
 */
export async function loadCollection<TItem extends { id: string }>(
  httpClient: ConvexHttpClient,
  config: LoadCollectionConfig
): Promise<ReadonlyArray<TItem>> {
  // NOTE: This implementation is limited because pullChanges only returns CRDT bytes,
  // not materialized documents. The code below attempts to construct items but
  // `change.document` does not exist in the actual pullChanges response.
  //
  // For production use, create a dedicated query that reads from your main table.

  const result = await httpClient.query(config.api.pullChanges as any, {
    collectionName: config.collection,
    checkpoint: { lastModified: 0 },
    limit: config.limit ?? 100,
  });

  const items: TItem[] = [];
  for (const change of result.changes) {
    // FIXME: change.document doesn't exist - pullChanges only returns crdtBytes
    // This code is here for backwards compatibility but won't work correctly
    const item = { id: change.documentId, ...change.document } as TItem;
    items.push(item);
  }

  return items;
}
