// Main exports

// ========================================
// CORE DATABASE & REPLICATION
// ========================================

export type { ConvexRxDBConfig, ConvexRxDBInstance } from './rxdb';
export { createConvexRxDB } from './rxdb';

// ========================================
// TYPE DEFINITIONS
// ========================================

export type { ConvexClient, ConvexRxDocument, RxJsonSchema } from './types';
export type { SyncedDocument, BaseActions, MiddlewareConfig } from './types';

// ========================================
// CONFLICT RESOLUTION
// ========================================

export type { RxConflictHandler, RxConflictHandlerInput } from './conflictHandler';
export {
  createClientWinsHandler,
  createCustomMergeHandler,
  createLastWriteWinsHandler,
  createServerWinsHandler,
  defaultConflictHandler,
} from './conflictHandler';

// ========================================
// STORAGE CONFIGURATION
// ========================================

export { getStorage, StorageType, storageTypeSchema } from './storage';
export type { StorageConfig } from './storage';
export { getRxStorageDexie, getRxStorageLocalstorage, getRxStorageMemory } from './storage';

// ========================================
// SCHEMA BUILDER UTILITIES
// ========================================

export { createSchema, inferBasicSchema, property } from './schema';
export type { SimpleSchema } from './schema';

// ========================================
// CONVEX FUNCTION GENERATORS
// ========================================

export { defineConvexRxTable, generateConvexRxFunctions } from './convex';
export type { ConvexRxTableFunctions } from './convex';

// ========================================
// SINGLETON MANAGEMENT
// ========================================

export {
  getSingletonInstance,
  removeSingletonInstance,
  markSingletonAsCleaningUp,
  hasSingletonInstance,
  clearAllSingletons,
  createSingletonKey,
} from './singleton';
export type { SingletonConfig } from './singleton';

// ========================================
// MIDDLEWARE
// ========================================

export { wrapActionsWithMiddleware, setupSyncErrorMiddleware } from './middleware';

// ========================================
// SUBSCRIPTIONS
// ========================================

export { buildSubscriptions, normalizeUnsubscribe } from './subscriptions';
export type { SubscriptionBuilder } from './subscriptions';

// ========================================
// BASE ACTIONS FACTORY
// ========================================

export { createBaseActions, setServerTime, getAdjustedTime } from './actions';
export type { ActionContext } from './actions';

// ========================================
// LOGGER UTILITIES (LogTape Integration)
// ========================================

export { configure, getConsoleSink, getLogger, getLogTapeLogger } from './logger';
export type { Config, LogLevel, Logger, Sink } from './logger';
