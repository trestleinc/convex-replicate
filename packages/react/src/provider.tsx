import { type ReactNode, createContext, useContext } from 'react';
import type { ConvexClient } from 'convex/browser';

const ConvexContext = createContext<ConvexClient | null>(null);

export function ConvexReplicateProvider({
  client,
  children,
}: {
  client: ConvexClient;
  children: ReactNode;
}) {
  return <ConvexContext.Provider value={client}>{children}</ConvexContext.Provider>;
}

export function useConvexClient(): ConvexClient {
  const client = useContext(ConvexContext);
  if (!client) throw new Error('Missing ConvexReplicateProvider');
  return client;
}
