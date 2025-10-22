import React from 'react';
import type { ConvexRxConfig, ConvexRxContextValue } from './types';

// ========================================
// CONTEXT CREATION
// ========================================

const ConvexRxContext = React.createContext<ConvexRxContextValue | null>(null);

// ========================================
// PROVIDER COMPONENT
// ========================================

export interface ConvexRxProviderProps extends ConvexRxConfig {
  children: React.ReactNode;
}

/**
 * Provider component for ConvexRx configuration.
 * Wrap your app with this to configure all ConvexRx hooks at once.
 *
 * @example
 * ```typescript
 * import { ConvexRxProvider } from '@convex-rx/react';
 * import { convexClient } from './convex';
 *
 * function App() {
 *   return (
 *     <ConvexRxProvider
 *       convexClient={convexClient}
 *       databaseName="myapp"
 *       enableLogging={process.env.NODE_ENV === 'development'}
 *     >
 *       <YourApp />
 *     </ConvexRxProvider>
 *   );
 * }
 * ```
 */
export function ConvexRxProvider({ children, ...config }: ConvexRxProviderProps) {
  // Runtime validation
  if (!config.convexClient) {
    throw new Error(
      'ConvexRxProvider requires a convexClient prop. ' +
        'Please provide a ConvexReactClient instance: ' +
        '<ConvexRxProvider convexClient={convexClient}>...</ConvexRxProvider>'
    );
  }

  const contextValue = React.useMemo<ConvexRxContextValue>(
    () => ({
      convexClient: config.convexClient,
      databaseName: config.databaseName,
      batchSize: config.batchSize,
      enableLogging: config.enableLogging,
      conflictHandler: config.conflictHandler,
      isConfigured: true,
    }),
    [
      config.convexClient,
      config.databaseName,
      config.batchSize,
      config.enableLogging,
      config.conflictHandler,
    ]
  );

  return <ConvexRxContext.Provider value={contextValue}>{children}</ConvexRxContext.Provider>;
}

// ========================================
// HOOK TO ACCESS CONTEXT
// ========================================

/**
 * Hook to access ConvexRx configuration from context.
 * Throws an error if used outside of ConvexRxProvider.
 *
 * @internal - Used by useConvexRx hook
 */
export function useConvexRxContext(): ConvexRxContextValue {
  const context = React.useContext(ConvexRxContext);

  if (!context || !context.isConfigured) {
    throw new Error(
      'useConvexRx must be used within a ConvexRxProvider. ' +
        'Wrap your app with <ConvexRxProvider convexClient={...}> at the root.'
    );
  }

  return context;
}

/**
 * Optional: Hook to access context without throwing.
 * Returns null if no provider exists.
 *
 * @internal
 */
export function useConvexRxContextOptional(): ConvexRxContextValue | null {
  return React.useContext(ConvexRxContext);
}
