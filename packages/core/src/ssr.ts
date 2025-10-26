import type { ConvexHttpClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';

export async function loadConvexData<TItem extends { id: string }>(
  httpClient: ConvexHttpClient,
  pullChangesQuery: FunctionReference<'query', 'public' | 'internal'>,
  options?: { limit?: number }
): Promise<ReadonlyArray<TItem>> {
  const result = await httpClient.query(pullChangesQuery as any, {
    checkpoint: { lastModified: 0 },
    limit: options?.limit ?? 100,
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
