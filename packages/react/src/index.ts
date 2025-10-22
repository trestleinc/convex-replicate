// Main exports

// Re-export core types for convenience
export type { ConvexRxDBConfig, ConvexRxDBInstance, RxJsonSchema } from '@convex-rx/core';
// Re-export conflict resolution utilities
export type { RxConflictHandler, RxConflictHandlerInput } from '@convex-rx/core';
export {
  createClientWinsHandler,
  createCustomMergeHandler,
  createLastWriteWinsHandler,
  createServerWinsHandler,
  defaultConflictHandler,
} from '@convex-rx/core';
// Type exports
export type { ReactConvexRxInstance } from './createReactConvexRx';
export { createReactConvexRx } from './createReactConvexRx';
export type { UseConvexRxActions, UseConvexRxResult } from './useConvexRx';
export { useConvexRx, useConvexRxActions, useConvexRxData } from './useConvexRx';
