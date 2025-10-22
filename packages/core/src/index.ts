// Main exports

// Type exports
export type { ConvexRxDBConfig, ConvexRxDBInstance } from './rxdb';
export { createConvexRxDB } from './rxdb';
export type { ConvexClient, ConvexRxDocument, RxJsonSchema } from './types';
export type { RxConflictHandler, RxConflictHandlerInput } from './conflictHandler';
export {
  createClientWinsHandler,
  createCustomMergeHandler,
  createLastWriteWinsHandler,
  createServerWinsHandler,
  defaultConflictHandler,
} from './conflictHandler';

// Schema builder utilities
export { createSchema, inferBasicSchema, property } from './schema';
export type { SimpleSchema } from './schema';

// Convex function generators
export { defineConvexRxTable, generateConvexRxFunctions } from './convex';
export type { ConvexRxTableFunctions } from './convex';
