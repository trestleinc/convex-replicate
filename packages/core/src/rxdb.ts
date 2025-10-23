import {
  addRxPlugin,
  createRxDatabase,
  type RxCollection,
  type RxDatabase,
  removeRxDatabase,
} from 'rxdb';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { type RxReplicationState, replicateRxCollection } from 'rxdb/plugins/replication';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';
import { Subject } from 'rxjs';
import { z } from 'zod';
import { defaultConflictHandler, type RxConflictHandler } from './conflictHandler';
import { getLogger } from './logger';
import { ErrorCategory, toConvexRxError } from './lib';
import { getStorage, type StorageConfig } from './storage';
import type { ConvexClient, ConvexRxDocument, RxJsonSchema } from './types';

// ========================================
// ENVIRONMENT DETECTION
// ========================================

/**
 * Check if running in development mode.
 * Handles environments where process.env is not available.
 */
function isDevelopment(): boolean {
  try {
    return process.env.NODE_ENV === 'development';
  } catch (_error) {
    // process.env might not be available in all environments
    return false;
  }
}

// ========================================
// PLUGIN INITIALIZATION
// ========================================

// RxDBUpdatePlugin enables soft deletes via doc.update() in actions.ts
addRxPlugin(RxDBUpdatePlugin);

if (isDevelopment()) {
  addRxPlugin(RxDBDevModePlugin);
}

// ========================================
// HELPER FUNCTIONS
// ========================================

function shouldUseMultiInstance(config: ConvexRxDBConfig<any>): boolean {
  if (config.multiInstance !== undefined) {
    return config.multiInstance;
  }
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

// ========================================
// TYPE DEFINITIONS
// ========================================

export interface ConvexRxDBConfig<T extends ConvexRxDocument> {
  databaseName: string;
  collectionName: string;
  schema: RxJsonSchema<T>;
  convexClient: ConvexClient;
  convexApi: {
    changeStream: any;
    pullDocuments: any;
    pushDocuments: any;
  };
  batchSize?: number;
  enableLogging?: boolean;
  /**
   * Optional conflict handler for resolving document conflicts during replication.
   * If not provided, uses defaultConflictHandler (last-write-wins strategy).
   *
   * **IMPORTANT**: This option is IGNORED when using CRDT schemas.
   * If your schema has `crdt: { field: 'crdts' }` configured (via `addCRDTToSchema()`),
   * RxDB's built-in CRDT conflict handler will be used automatically and this setting
   * has no effect. CRDTs provide automatic, operation-based conflict resolution.
   *
   * Available strategies (for non-CRDT schemas):
   * - createServerWinsHandler() - Always use server state
   * - createClientWinsHandler() - Always use client state (can cause data loss)
   * - createLastWriteWinsHandler() - Use newest updatedTime (default)
   * - createFieldLevelMergeHandler() - Merge changes field-by-field
   * - createCustomMergeHandler() - Custom merge logic
   */
  conflictHandler?: RxConflictHandler<T>;
  /**
   * Storage configuration.
   *
   * @default { type: StorageType.DEXIE } - Fast IndexedDB storage (recommended)
   *
   * @example Use default (Dexie.js - recommended)
   * storage: { type: StorageType.DEXIE }
   *
   * @example Use LocalStorage (legacy)
   * storage: { type: StorageType.LOCALSTORAGE }
   *
   * @example Use custom storage
   * storage: { customStorage: getRxStorageIndexedDB() }
   */
  storage?: StorageConfig;
  /**
   * Time in milliseconds to wait before retrying failed operations.
   * @default 5000
   */
  retryTime?: number;
  /**
   * Custom replication identifier. Defaults to `convex-${collectionName}`.
   * Useful for multi-tenant scenarios or custom replication instances.
   */
  replicationIdentifier?: string;
  /**
   * Wait for this instance to become leader before starting replication.
   * Set to false to sync in all tabs simultaneously.
   * @default false
   */
  waitForLeadership?: boolean;
  /**
   * Push batch size (1-1000). Controls how many documents are pushed at once.
   * @default 100
   */
  pushBatchSize?: number;
  /**
   * Enable cross-tab synchronization. Auto-detected: true in browser, false in Node.js.
   * @default auto-detected
   */
  multiInstance?: boolean;
  /**
   * Enable RxDB's event reduce optimization for query performance.
   * @default false
   */
  eventReduce?: boolean;
  /**
   * Enable key compression for ~40% storage reduction.
   * @default true
   */
  keyCompression?: boolean;
}

/**
 * Instance returned by createConvexRxDB containing RxDB primitives
 */
export interface ConvexRxDBInstance<T extends ConvexRxDocument> {
  /** RxDB database instance */
  rxDatabase: RxDatabase;
  /** RxDB collection instance typed with document type T */
  rxCollection: RxCollection<T>;
  /** RxDB replication state with observables (error$, active$, received$, sent$) */
  replicationState: RxReplicationState<T, any>;
  /** Cleanup function to cancel replication and remove database */
  cleanup: () => Promise<void>;
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Validates batch size is within acceptable range (1-1000)
 */
function validateBatchSize(batchSize: number | undefined, defaultValue: number): number {
  if (batchSize === undefined) return defaultValue;

  if (batchSize < 1 || batchSize > 1000) {
    throw new Error(`Invalid batch size: ${batchSize}. Must be between 1 and 1000.`);
  }

  return batchSize;
}

/**
 * Zod schema for validating pulled documents from Convex
 */
const pullDocumentSchema = z.object({
  id: z.string().min(1),
  updatedTime: z.number().positive(),
  deleted: z.boolean().optional(),
});

/**
 * Zod schema for validating user-provided config
 */
const configSchema = z.object({
  databaseName: z
    .string()
    .min(1, 'Database name cannot be empty')
    .max(100, 'Database name too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Database name must contain only alphanumeric, underscore, or dash'),
  collectionName: z
    .string()
    .min(1, 'Collection name cannot be empty')
    .max(100, 'Collection name too long')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Collection name must contain only alphanumeric, underscore, or dash'
    ),
  schema: z.any(), // RxJsonSchema validation is complex
  convexClient: z.any(), // ConvexClient validation is complex
  convexApi: z.object({
    changeStream: z.any(),
    pullDocuments: z.any(),
    pushDocuments: z.any(),
  }),
  batchSize: z.number().int().min(1).max(1000).optional(),
  enableLogging: z.boolean().optional(),
  conflictHandler: z.any().optional(),
  storage: z.any().optional(),
  retryTime: z.number().int().min(100).max(60000).optional(),
  replicationIdentifier: z.string().optional(),
  waitForLeadership: z.boolean().optional(),
  pushBatchSize: z.number().int().min(1).max(1000).optional(),
});

// ========================================
// MAIN API: CREATE CONVEX RXDB
// ========================================

/**
 * Create a ConvexRx sync instance bridging RxDB and Convex.
 *
 * This is the main entry point for the ConvexRx library. It creates:
 * - RxDB database for local storage
 * - Bidirectional replication with Convex
 * - WebSocket change stream for real-time updates
 * - Automatic conflict resolution
 *
 * @template T - Document type extending ConvexRxDocument
 * @param config - Configuration object
 * @returns Instance with RxDB primitives and cleanup function
 *
 * @throws {Error} If config validation fails
 * @throws {Error} If database/collection creation fails
 */
export async function createConvexRxDB<T extends ConvexRxDocument>(
  config: ConvexRxDBConfig<T>
): Promise<ConvexRxDBInstance<T>> {
  // Validate config
  try {
    configSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      throw new Error(`Invalid ConvexRxDB configuration:\n${issues.join('\n')}`);
    }
    throw error;
  }
  const {
    databaseName,
    collectionName,
    schema,
    convexClient,
    convexApi,
    enableLogging = true,
    conflictHandler = defaultConflictHandler,
  } = config;

  // Create logger instance
  const logger = getLogger(collectionName, enableLogging);

  logger.info('Creating RxDB database', { databaseName });

  const db = await createRxDatabase({
    name: databaseName,
    storage: getStorage(config.storage),
    multiInstance: shouldUseMultiInstance(config),
    eventReduce: config.eventReduce ?? false,
    ignoreDuplicate: isDevelopment(),
  });

  const schemaWithDeleted = {
    ...schema,
    keyCompression: config.keyCompression ?? true,
    properties: {
      ...schema.properties,
      _deleted: {
        type: 'boolean',
      },
    },
  } as RxJsonSchema<T & { _deleted?: boolean }>;

  // Detect if schema has CRDT enabled
  // When CRDTs are enabled, RxDB requires using its built-in CRDT conflict handler
  const hasCRDT = !!schemaWithDeleted.crdt;

  if (hasCRDT) {
    logger.info('Using CRDT conflict handler (custom conflictHandler ignored)');
  } else {
    logger.info('Using custom conflict handler');
  }

  // Only pass conflictHandler if CRDT is NOT enabled
  // RxDB throws CRDT3 error if conflictHandler is provided with CRDT schemas
  const collections = await db.addCollections({
    [collectionName]: hasCRDT
      ? {
          schema: schemaWithDeleted,
        }
      : {
          schema: schemaWithDeleted,
          // Type cast: RxConflictHandler<T> satisfies RxDB's internal conflict handler interface
          conflictHandler: conflictHandler as any,
        },
  });

  const rxCollection = collections[collectionName];

  logger.info('RxDB collection created');

  const pullStream$ = new Subject<'RESYNC' | any>();
  let lastKnownState: { timestamp: number; checksum: number; count: number } | null = null;
  let unsubscribeChangeStream: (() => void) | null = null;
  let retryCount = 0;
  const maxRetries = 10;

  function setupChangeStream() {
    logger.info('Setting up Convex change stream', { retryCount });

    try {
      const changeWatch = convexClient.watchQuery<{
        timestamp: number;
        checksum: number;
        count: number;
      }>(convexApi.changeStream, {});

      const unsubscribe = changeWatch.onUpdate(() => {
        retryCount = 0;
        const data = changeWatch.localQueryResult();

        if (data) {
          if (lastKnownState === null) {
            lastKnownState = {
              timestamp: data.timestamp,
              checksum: data.checksum,
              count: data.count,
            };
            pullStream$.next('RESYNC');
            logger.info('Initial change stream state', { data });
            return;
          }

          if (
            data.timestamp !== lastKnownState.timestamp ||
            data.checksum !== lastKnownState.checksum ||
            data.count !== lastKnownState.count
          ) {
            logger.info('Change detected', { data, lastKnownState });
            lastKnownState = {
              timestamp: data.timestamp,
              checksum: data.checksum,
              count: data.count,
            };
            pullStream$.next('RESYNC');
          }
        }
      });

      unsubscribeChangeStream = unsubscribe;
    } catch (error) {
      logger.error('Failed to setup change stream', { error });

      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * 2 ** retryCount, 30000);
        retryCount++;
        logger.info(`Retrying change stream in ${delay}ms (attempt ${retryCount}/${maxRetries})`);
        setTimeout(setupChangeStream, delay);
      } else {
        logger.error('Max retries reached for change stream');
      }
    }
  }

  setupChangeStream();

  let lastPushTime = 0;
  const MIN_PUSH_INTERVAL = 100;

  const replicationState = replicateRxCollection({
    collection: rxCollection,
    replicationIdentifier: config.replicationIdentifier ?? `convex-${collectionName}`,
    live: true,
    retryTime: config.retryTime ?? 5000,
    autoStart: true,
    waitForLeadership: config.waitForLeadership ?? false,

    pull: {
      async handler(checkpointOrNull, batchSize) {
        const checkpoint = checkpointOrNull || { id: '', updatedTime: 0 };

        logger.info('Pull from checkpoint', { checkpoint });

        try {
          const result = await convexClient.query<{
            documents: any[];
            checkpoint: any;
          }>(convexApi.pullDocuments, {
            checkpoint,
            limit: batchSize,
          });

          const validDocuments = result.documents.filter((doc, index) => {
            try {
              pullDocumentSchema.parse(doc);
              return true;
            } catch (error) {
              logger.error('Invalid document from Convex', {
                doc,
                index,
                error: error instanceof Error ? error.message : String(error),
              });
              return false;
            }
          });

          if (validDocuments.length < result.documents.length) {
            logger.warn('Filtered out invalid documents', {
              total: result.documents.length,
              valid: validDocuments.length,
              invalid: result.documents.length - validDocuments.length,
            });
          }

          logger.info('Pulled documents', {
            documentCount: validDocuments.length,
            checkpoint: result.checkpoint,
          });

          return {
            documents: validDocuments,
            checkpoint: result.checkpoint,
          };
        } catch (error) {
          logger.error('Pull error', { error });

          const convexError = toConvexRxError(error);
          if (convexError.category === ErrorCategory.NETWORK) {
            logger.info('Network error detected, triggering RxDB retry');
            throw error;
          }

          logger.info('Non-network error, skipping batch but keeping checkpoint');
          return {
            documents: [],
            checkpoint: checkpoint,
          };
        }
      },
      batchSize: validateBatchSize(config.batchSize, 300),
      stream$: pullStream$.asObservable(),
      modifier: (doc: any) => {
        const { deleted, ...rest } = doc;

        // Parse CRDT field from JSON string back to object
        // Convex stores it as string, RxDB needs it as object
        if (hasCRDT && schemaWithDeleted.crdt) {
          const crdtField = schemaWithDeleted.crdt.field;
          const crdtString = rest[crdtField];

          logger.debug('Parsing CRDT field from pull', {
            documentId: doc.id,
            crdtField,
            hasCrdtString: !!crdtString,
          });

          return {
            ...rest,
            [crdtField]: crdtString ? JSON.parse(crdtString) : undefined,
            _deleted: deleted || false,
          };
        }

        const transformed = {
          ...rest,
          _deleted: deleted || false,
        };

        if (deleted) {
          logger.info('Pull modifier - Transforming deleted doc', {
            from: doc,
            to: transformed,
          });
        }

        return transformed;
      },
    },

    push: {
      async handler(changeRows) {
        const now = Date.now();
        const timeSinceLastPush = now - lastPushTime;
        if (timeSinceLastPush < MIN_PUSH_INTERVAL) {
          const waitTime = MIN_PUSH_INTERVAL - timeSinceLastPush;
          logger.info(`Rate limiting: waiting ${waitTime}ms before push`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
        lastPushTime = Date.now();

        logger.info(`Pushing ${changeRows.length} changes`);
        logger.debug('Push changeRows', {
          count: changeRows.length,
          sample: changeRows[0] // Log first document to see structure
        });

        try {
          const conflicts = await convexClient.mutation<any[]>(convexApi.pushDocuments, {
            changeRows,
          });

          if (conflicts && conflicts.length > 0) {
            logger.info('Conflicts detected', {
              conflictCount: conflicts.length,
              conflictIds: conflicts.map((c) => c.id),
            });

            // Transform conflicts from Convex format (deleted) to RxDB format (_deleted)
            // This matches the pull modifier transformation
            const transformedConflicts = conflicts.map((conflict) => {
              const { deleted, ...rest } = conflict;
              const transformed = {
                ...rest,
                _deleted: deleted || false,
              };

              logger.debug('Transformed push conflict', {
                from: conflict,
                to: transformed,
              });

              return transformed;
            });

            return transformedConflicts;
          }

          return [];
        } catch (error) {
          console.error('=== PUSH ERROR START ===');
          console.error('Error object:', error);
          console.error('Error message:', error instanceof Error ? error.message : 'Not an Error object');
          console.error('Error type:', error?.constructor?.name);
          console.error('Error stringified:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
          console.error('=== PUSH ERROR END ===');

          logger.error('Push error details', {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            errorType: error?.constructor?.name,
            fullError: error,
          });

          const convexError = toConvexRxError(error);
          if (convexError.category === ErrorCategory.NETWORK) {
            logger.info('Network error detected, triggering RxDB retry');
            throw error;
          }

          logger.info('Non-network error, returning empty conflicts');
          return [];
        }
      },
      batchSize: validateBatchSize(config.pushBatchSize, 100),
      modifier: (doc: any) => {
        const { _deleted, ...rest } = doc;
        const deleted = _deleted === true;

        if (typeof _deleted !== 'boolean' && _deleted !== undefined) {
          logger.warn('Invalid _deleted field type - schema mismatch', {
            id: doc.id,
            _deleted,
            type: typeof _deleted,
          });
        }

        // Serialize CRDT field to JSON string for Convex compatibility
        // Convex rejects field names starting with $ (like $set, $inc)
        if (hasCRDT && schemaWithDeleted.crdt) {
          const crdtField = schemaWithDeleted.crdt.field;
          const { [crdtField]: crdtData, ...restWithoutCrdt } = rest;

          logger.debug('Serializing CRDT field for push', {
            documentId: doc.id,
            crdtField,
            hasCrdtData: !!crdtData,
          });

          return {
            ...restWithoutCrdt,
            [crdtField]: crdtData ? JSON.stringify(crdtData) : undefined,
            deleted,
          };
        }

        return {
          ...rest,
          deleted,
        };
      },
    },
  });

  const subscriptions: Array<{ unsubscribe: () => void }> = [];

  subscriptions.push(
    replicationState.error$.subscribe((error: any) => {
      logger.error('Replication error', { error });
    })
  );

  subscriptions.push(
    replicationState.active$.subscribe((active: boolean) => {
      logger.info('Replication active', { active });
    })
  );

  subscriptions.push(
    replicationState.received$.subscribe((doc: any) => {
      logger.info('Received doc', {
        id: doc.id,
        _deleted: doc._deleted,
        fullDoc: doc,
      });
    })
  );

  subscriptions.push(
    replicationState.sent$.subscribe((doc: any) => {
      logger.info('Sent doc', {
        id: doc.id,
        _deleted: doc._deleted,
        fullDoc: doc,
      });
    })
  );

  try {
    logger.info('Waiting for initial replication...');

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Initial replication timeout')), 30000);
    });

    await Promise.race([replicationState.awaitInitialReplication(), timeoutPromise]);

    logger.info('Initial replication complete!');
  } catch (error) {
    logger.error('Initial replication failed', { error });
    logger.info('Falling back to optimistic UI');
  }

  let isCleaningUp = false;

  const cleanup = async () => {
    if (isCleaningUp) {
      logger.warn('Cleanup already in progress, skipping');
      return;
    }

    isCleaningUp = true;
    logger.info('Cleaning up and removing storage...');

    try {
      logger.info('Unsubscribing from RxJS subscriptions...');
      for (const subscription of subscriptions) {
        try {
          subscription.unsubscribe();
        } catch (error) {
          logger.error('Failed to unsubscribe', { error });
        }
      }

      logger.info('Unsubscribing from Convex change stream...');
      if (unsubscribeChangeStream) {
        try {
          unsubscribeChangeStream();
        } catch (error) {
          logger.error('Failed to unsubscribe from change stream', { error });
        }
      }

      logger.info('Cancelling replication...');
      try {
        await replicationState.cancel();
      } catch (error) {
        logger.error('Failed to cancel replication', { error });
      }

      logger.info('Closing ConvexClient connection...');
      if (convexClient && typeof convexClient.close === 'function') {
        try {
          convexClient.close();
        } catch (error) {
          logger.error('Failed to close ConvexClient', { error });
        }
      }

      logger.info('Removing database...');
      try {
        await db.remove();
      } catch (error) {
        logger.error('Failed to remove database', { error });
      }

      logger.info('Removing from storage layer...');
      try {
        await removeRxDatabase(databaseName, getStorage(config.storage));
      } catch (error) {
        logger.error('Failed to remove from storage layer', { error });
      }

      logger.info('Storage removed successfully');
    } finally {
      isCleaningUp = false;
    }
  };

  return {
    rxDatabase: db,
    rxCollection,
    replicationState,
    cleanup,
  };
}
