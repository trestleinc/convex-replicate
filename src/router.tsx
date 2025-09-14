import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { routeTree } from "./routeTree.gen";
import { ConvexReactClient } from "convex/react";

// Export the queryClient and convexClient so other modules can use them
export let queryClient: QueryClient;
export let convexClient: ConvexReactClient;

export function createRouter() {
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
  const convexUrl = import.meta.env.PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("PUBLIC_CONVEX_URL environment variable is required");
  }
  convexClient = new ConvexReactClient(convexUrl);

  const router = routerWithQueryClient(
    createTanStackRouter({
      routeTree,
      defaultPreload: "intent",
      context: { queryClient },
    }),
    queryClient,
  );

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
