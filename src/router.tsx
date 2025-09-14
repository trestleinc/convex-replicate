import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { routeTree } from "./routeTree.gen";
import { setConvexClient } from "./useTasks";

// Export the queryClient so other modules can use it
export let queryClient: QueryClient;

export function createRouter() {
  const CONVEX_URL = import.meta.env.PUBLIC_CONVEX_URL;

  if (!CONVEX_URL) {
    console.error("missing envar CONVEX_URL");
  }
  
  // Create both ConvexQueryClient (for TanStack Query) and ConvexReactClient (for React/subscriptions)
  const convexQueryClient = new ConvexQueryClient(CONVEX_URL);
  const convexReactClient = new ConvexReactClient(CONVEX_URL);

  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  });
  convexQueryClient.connect(queryClient);

  // Set up the ConvexReactClient for local-first sync (this one has onUpdate)
  setConvexClient(convexReactClient);

  const router = routerWithQueryClient(
    createTanStackRouter({
      routeTree,
      defaultPreload: "intent",
      context: { queryClient },
      Wrap: ({ children }) => (
        <ConvexProvider client={convexReactClient}>
          {children}
        </ConvexProvider>
      ),
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
