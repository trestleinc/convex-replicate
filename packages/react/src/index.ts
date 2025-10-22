/**
 * @convex-rx/react - React hooks for offline-first sync with Convex
 *
 * Main exports:
 * - useConvexRx - Primary hook for syncing data (simple by default, infinitely extensible)
 * - ConvexRxProvider - Optional provider for shared configuration
 * - Schema builders and utilities from core package
 * - Conflict resolution handlers
 */

// ========================================
// PRIMARY EXPORTS
// ========================================

/** Main hook for offline-first sync with Convex */
export { useConvexRx } from './useConvexRx';

/** Optional provider for shared configuration across hooks */
export { ConvexRxProvider } from './ConvexRxProvider';

// ========================================
// TYPE EXPORTS
// ========================================

/** Hook configuration types (React-specific) */
export type { ConvexRxConfig, HookContext, UseConvexRxConfig, UseConvexRxResult } from './types';

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
