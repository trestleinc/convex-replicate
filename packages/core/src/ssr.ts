import type { ConvexHttpClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';

/**
 * Load initial data from Convex for server-side rendering.
 *
 * This function queries the Convex backend to fetch initial document data
 * that can be used to hydrate the client-side state during SSR.
 *
 * @param httpClient - Convex HTTP client for server-side queries
 * @param pullChangesQuery - The pullChanges query function reference
 * @param options - Configuration options
 * @param options.collectionName - Name of the collection to load
 * @param options.limit - Maximum number of items to load (default: 100)
 * @returns Array of items from the collection
 *
 * @example
 * ```typescript
 * const tasks = await loadConvexData<Task>(httpClient, api.tasks.pullChanges, {
 *   collectionName: 'tasks',
 *   limit: 100
 * });
 * ```
 */
export async function loadConvexData<TItem extends { id: string }>(
  httpClient: ConvexHttpClient,
  pullChangesQuery: FunctionReference<'query', 'public' | 'internal'>,
  options: { collectionName: string; limit?: number }
): Promise<ReadonlyArray<TItem>> {
  const result = await httpClient.query(pullChangesQuery as any, {
    collectionName: options.collectionName,
    checkpoint: { lastModified: 0 },
    limit: options.limit ?? 100,
  });

  const items: TItem[] = [];

  for (const change of result.changes) {
    const item = {
      id: change.documentId,
      ...change.document,
    } as TItem;
    items.push(item);
  }

  return items;
}
