// Main exports

// Re-export core types for convenience
export type {
  ConvexRxSyncInstance,
  ConvexSyncConfig,
  RxJsonSchema,
} from '@convex-rx/core';
// Type exports
export type { ConvexReactSyncInstance } from './createConvexReactSync';
export { createConvexReactSync } from './createConvexReactSync';
export type { UseConvexSyncActions, UseConvexSyncResult } from './useConvexSync';
export {
  useConvexSync,
  useConvexSyncActions,
  useConvexSyncData,
} from './useConvexSync';
