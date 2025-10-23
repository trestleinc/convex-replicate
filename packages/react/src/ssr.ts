/**
 * SSR utilities for preloading Convex data on the server side.
 *
 * Enables fast server-side rendering by fetching initial data from Convex
 * before hydration, avoiding loading states on first render.
 *
 * @example TanStack Start loader
 * ```typescript
 * import { createFileRoute } from '@tanstack/react-router';
 * import { preloadConvexRxData } from '@convex-rx/react/ssr';
 * import { convexClient } from './convexClient';
 * import { api } from '../convex/_generated/api';
 *
 * export const Route = createFileRoute('/')({
 *   loader: async () => {
 *     const tasks = await preloadConvexRxData({
 *       convexClient,
 *       convexApi: {
 *         pullDocuments: api.tasks.pullDocuments,
 *       },
 *     });
 *     return { tasks };
 *   },
 * });
 *
 * function Component() {
 *   const { tasks } = Route.useLoaderData();
 *   const tasksDb = useConvexRx({
 *     table: 'tasks',
 *     schema: taskSchema,
 *     convexApi: api.tasks,
 *     initialData: tasks,
 *   });
 *   // No loading state - data available immediately!
 * }
 * ```
 */

import { ConvexHttpClient } from 'convex/browser';
import type { SyncedDocument } from '@convex-rx/core';
import { getLogger } from '@convex-rx/core';

/**
 * Configuration for SSR data preloading.
 */
export interface PreloadConvexRxDataConfig {
  /** Convex deployment URL (e.g., process.env.CONVEX_URL) */
  convexUrl: string;
  /** Convex API endpoints (only pullDocuments needed for preload) */
  convexApi: {
    pullDocuments: any;
  };
  /** Batch size for initial data pull (default: 300) */
  batchSize?: number;
}

/**
 * Preload Convex data on the server for SSR.
 *
 * Fetches all documents from Convex starting from checkpoint 0,
 * returning data that can be passed as `initialData` to `useConvexRx`.
 *
 * Benefits:
 * - No loading state on first render
 * - Faster perceived performance
 * - SEO-friendly content
 * - Reduces layout shift
 *
 * @param config - Preload configuration
 * @returns Array of documents fetched from Convex
 *
 * @example
 * ```typescript
 * // In TanStack Start loader
 * export const Route = createFileRoute('/')({
 *   loader: async () => {
 *     const data = await preloadConvexRxData({
 *       convexClient,
 *       convexApi: { pullDocuments: api.tasks.pullDocuments },
 *     });
 *     return { initialTasks: data };
 *   },
 * });
 *
 * // In component
 * const { initialTasks } = Route.useLoaderData();
 * const tasks = useConvexRx({
 *   table: 'tasks',
 *   schema: taskSchema,
 *   convexApi: api.tasks,
 *   initialData: initialTasks,
 * });
 * ```
 */
export async function preloadConvexRxData<TData extends SyncedDocument>(
  config: PreloadConvexRxDataConfig
): Promise<TData[]> {
  const { convexUrl, convexApi, batchSize = 300 } = config;

  if (!convexUrl || typeof convexUrl !== 'string') {
    throw new Error(
      'convexUrl is required for SSR preloading. ' +
        'Make sure to pass your Convex deployment URL (e.g., process.env.VITE_CONVEX_URL)'
    );
  }

  try {
    new URL(convexUrl);
  } catch {
    throw new Error(
      `Invalid convexUrl: "${convexUrl}". ` +
        'Must be a valid URL (e.g., https://your-deployment.convex.cloud)'
    );
  }

  const logger = getLogger('ssr-preload', true);

  try {
    logger.info('Preloading Convex data for SSR via HTTP', { convexUrl, batchSize });

    const httpClient = new ConvexHttpClient(convexUrl);

    // Pull all documents from beginning (checkpoint 0)
    const result = (await httpClient.query(convexApi.pullDocuments, {
      checkpoint: { id: '', updatedTime: 0 },
      limit: batchSize,
    })) as { documents: TData[]; checkpoint: any };

    // Filter out soft-deleted items and sort by creationTime (newest first)
    // Note: Using 'deleted' field (Convex format), not '_deleted' (RxDB format)
    // SSR pulls raw data from Convex before RxDB transformation
    const activeDocuments = result.documents
      .filter((doc: any) => !doc.deleted)
      .sort((a: any, b: any) => (b.creationTime || 0) - (a.creationTime || 0));

    logger.info('Successfully preloaded data via HTTP', { documentCount: activeDocuments.length });

    return activeDocuments;
  } catch (error) {
    // Log error but don't crash SSR
    logger.error('Failed to preload data for SSR', { error });
    // Return empty array to allow hydration with loading state
    return [];
  }
}
