/**
 * @convex-rx/react - React hooks for offline-first sync with Convex
 *
 * Main exports:
 * - useConvexRx - Primary hook for syncing data (simple by default, infinitely extensible)
 * - ConvexRxProvider - REQUIRED provider for Convex client configuration
 * - Schema builders and utilities from core package
 * - Conflict resolution handlers
 *
 * IMPORTANT: ConvexRxProvider is REQUIRED. Wrap your app root with it:
 *
 * ```tsx
 * import { ConvexRxProvider } from '@convex-rx/react';
 * import { convexClient } from './convex';
 *
 * function App() {
 *   return (
 *     <ConvexRxProvider convexClient={convexClient}>
 *       <YourApp />
 *     </ConvexRxProvider>
 *   );
 * }
 * ```
 */

// ========================================
// PRIMARY EXPORTS
// ========================================

/** Main hook for offline-first sync with Convex. Requires ConvexRxProvider. */
export { useConvexRx } from './useConvexRx';

/** REQUIRED provider for Convex client configuration. Must wrap your app root. */
export { ConvexRxProvider } from './ConvexRxProvider';

/** SSR utilities for preloading data on the server */
export { preloadConvexRxData } from './ssr';
export type { PreloadConvexRxDataConfig } from './ssr';

// ========================================
// TYPE EXPORTS
// ========================================

/** Hook configuration types (React-specific) */
export type {
  ConvexRxConfig,
  ConvexRxStatus,
  HookContext,
  UseConvexRxConfig,
  UseConvexRxResult,
} from './types';

/** Error handling types and utilities (re-exported from core) */
export type {
  ConvexRxError,
  InitializationError,
  SchemaError,
  NetworkError,
  ReplicationError,
  ConflictError,
  ValidationError,
  StorageError,
  UnknownError,
  ErrorHandlerConfig,
} from '@convex-rx/core';

export {
  ErrorCategory,
  ErrorSeverity,
  RecoveryStrategy,
  ConvexRxErrorHandler,
  createInitializationError,
  createSchemaError,
  createNetworkError,
  createReplicationError,
  createConflictError,
  createValidationError,
  createStorageError,
  createUnknownError,
  toConvexRxError,
  isConvexRxError,
  withErrorHandling,
  withRetry,
} from '@convex-rx/core';

// Note: BaseActions, MiddlewareConfig, and SyncedDocument are now in @convex-rx/core
// Import them directly from '@convex-rx/core' instead

/** Builder types for extensibility */
export type { ActionBuilder, QueryBuilder, SubscriptionBuilder } from './types';

/** Advanced types for direct access */
export type { ConvexRxInstance } from './types';

// ========================================
// RE-EXPORTS FROM CORE
// ========================================

/** Core document and schema types */
export type { ConvexClient, ConvexRxDocument, RxJsonSchema } from '@convex-rx/core';

/** Conflict resolution types and handlers */
export type { RxConflictHandler, RxConflictHandlerInput } from '@convex-rx/core';
export {
  createClientWinsHandler,
  createCustomMergeHandler,
  createLastWriteWinsHandler,
  createServerWinsHandler,
  defaultConflictHandler,
} from '@convex-rx/core';

/** Schema builder utilities */
export { createSchema, inferBasicSchema, property } from '@convex-rx/core';
export type { SimpleSchema } from '@convex-rx/core';

/** Convex function generators */
export { defineConvexRxTable, generateConvexRxFunctions } from '@convex-rx/core';
export type { ConvexRxTableFunctions } from '@convex-rx/core';

/** Storage configuration */
export { getStorage, StorageType, storageTypeSchema } from '@convex-rx/core';
export type { StorageConfig } from '@convex-rx/core';
export { getRxStorageDexie, getRxStorageLocalstorage, getRxStorageMemory } from '@convex-rx/core';
