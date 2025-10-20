import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { routerWithQueryClient } from '@tanstack/react-router-with-query';
import { ConvexReactClient } from 'convex/react';

// Import the generated route tree
import { routeTree } from './routeTree.gen';

// Export the queryClient and convexClient so other modules can use them
export let queryClient: QueryClient;
export let convexClient: ConvexReactClient;

// Create a new router instance
export const getRouter = () => {
  // Create QueryClient for TanStack Router
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes
        retry: 1,
      },
    },
  });

  // Create Convex client for RxDB replication (WebSocket-based)
  const convexUrl = import.meta.env.VITE_CONVEX_URL;
  if (!convexUrl) {
    throw new Error('VITE_CONVEX_URL environment variable is required');
  }
  convexClient = new ConvexReactClient(convexUrl);

  const router = routerWithQueryClient(
    createRouter({
      routeTree,
      scrollRestoration: true,
      defaultPreloadStaleTime: 0,
      context: { queryClient },
    }),
    queryClient
  );

  return router;
};

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
