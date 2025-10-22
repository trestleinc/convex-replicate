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
import { getStorage, type StorageConfig } from './storage';
import type { ConvexClient, ConvexRxDocument, RxJsonSchema } from './types';
import { isNetworkError } from './types';

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

// Add required plugins
// Note: RxDBUpdatePlugin is used for soft deletes via doc.update() in actions.ts
addRxPlugin(RxDBUpdatePlugin);

// Conditionally add dev mode plugin
if (isDevelopment()) {
  addRxPlugin(RxDBDevModePlugin);
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
   * Available strategies:
   * - createServerWinsHandler() - Always use server state
   * - createClientWinsHandler() - Always use client state (can cause data loss)
   * - createLastWriteWinsHandler() - Use newest updatedTime (default)
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

  // 1. Create RxDB database
  const db = await createRxDatabase({
    name: databaseName,
    storage: getStorage(config.storage),
    multiInstance: true,
    eventReduce: true,
    ignoreDuplicate: isDevelopment(),
  });

  // 2. Add collection with schema
  // Extend schema to include _deleted field for soft deletes
  // Note: keyCompression is added at schema level but not in RxJsonSchema type
  const schemaWithDeleted = {
    ...schema,
    keyCompression: true, // Enable key compression for ~40% storage reduction
    properties: {
      ...schema.properties,
      _deleted: {
        type: 'boolean',
      },
    },
  } as RxJsonSchema<T & { _deleted?: boolean }>;

  const collections = await db.addCollections({
    [collectionName]: {
      schema: schemaWithDeleted,
      conflictHandler: conflictHandler as any, // Type cast needed for RxDB's generic types
    },
  });

  const rxCollection = collections[collectionName];

  logger.info('RxDB collection created');

  // 3. Set up WebSocket stream for real-time updates
  const pullStream$ = new Subject<'RESYNC' | any>();
  let lastKnownState: { timestamp: number; count: number } | null = null;
  let unsubscribeChangeStream: (() => void) | null = null;
  let retryCount = 0;
  const maxRetries = 10;

  function setupChangeStream() {
    logger.info('Setting up Convex change stream', { retryCount });

    try {
      const changeWatch = convexClient.watchQuery(convexApi.changeStream, {});

      const unsubscribe = changeWatch.onUpdate(() => {
        retryCount = 0; // Reset on successful connection
        const data = changeWatch.localQueryResult();

        if (data) {
          // First update - initialize state
          if (lastKnownState === null) {
            lastKnownState = { timestamp: data.timestamp, count: data.count };
            pullStream$.next('RESYNC');
            logger.info('Initial change stream state', { data });
            return;
          }

          // Subsequent updates - check for changes
          if (data.timestamp !== lastKnownState.timestamp || data.count !== lastKnownState.count) {
            logger.info('Change detected', { data });
            lastKnownState = { timestamp: data.timestamp, count: data.count };
            pullStream$.next('RESYNC');
          }
        }
      });

      unsubscribeChangeStream = unsubscribe;
    } catch (error) {
      logger.error('Failed to setup change stream', { error });

      // Retry with exponential backoff
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * 2 ** retryCount, 30000); // Cap at 30s
        retryCount++;
        logger.info(`Retrying change stream in ${delay}ms (attempt ${retryCount}/${maxRetries})`);
        setTimeout(setupChangeStream, delay);
      } else {
        logger.error('Max retries reached for change stream');
      }
    }
  }

  setupChangeStream();

  // 4. Set up RxDB replication using native replicateRxCollection
  // Add rate limiting state
  let lastPushTime = 0;
  const MIN_PUSH_INTERVAL = 100; // 100ms = max 10 pushes/sec

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

          // Validate documents before inserting into RxDB
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

          // Network errors should be thrown to trigger RxDB retry
          if (isNetworkError(error)) {
            logger.info('Network error detected, triggering RxDB retry');
            throw error; // RxDB will retry with retryTime
          }

          // Non-network errors: skip batch, keep checkpoint
          logger.info('Non-network error, skipping batch but keeping checkpoint');
          return {
            documents: [],
            checkpoint: checkpoint,
          };
        }
      },
      batchSize: validateBatchSize(config.batchSize, 300),
      stream$: pullStream$.asObservable(),
      // Transform Convex's 'deleted' field to RxDB's '_deleted' field
      modifier: (doc: any) => {
        if (!doc) {
          logger.warn('Received null/undefined document in pull modifier');
          return undefined; // Return undefined to skip document
        }
        const { deleted, ...rest } = doc;
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
        // Rate limiting
        const now = Date.now();
        const timeSinceLastPush = now - lastPushTime;
        if (timeSinceLastPush < MIN_PUSH_INTERVAL) {
          const waitTime = MIN_PUSH_INTERVAL - timeSinceLastPush;
          logger.info(`Rate limiting: waiting ${waitTime}ms before push`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
        lastPushTime = Date.now();

        logger.info(`Pushing ${changeRows.length} changes`);

        try {
          const conflicts = await convexClient.mutation<any[]>(convexApi.pushDocuments, {
            changeRows,
          });

          if (conflicts && conflicts.length > 0) {
            logger.info('Conflicts detected', { conflictCount: conflicts.length });
          }

          return conflicts || [];
        } catch (error) {
          logger.error('Push error', { error });

          // Network errors should be thrown to trigger retry
          if (isNetworkError(error)) {
            logger.info('Network error detected, triggering RxDB retry');
            throw error;
          }

          // Non-network errors: return empty conflicts
          logger.info('Non-network error, returning empty conflicts');
          return [];
        }
      },
      batchSize: validateBatchSize(config.pushBatchSize, 100),
      // Transform RxDB's '_deleted' field to Convex's 'deleted' field before sending
      modifier: (doc: any) => {
        if (!doc) {
          logger.warn('Received null/undefined document in push modifier');
          return undefined;
        }
        const { _deleted, ...rest } = doc;

        // Validate and normalize _deleted to boolean
        const deleted = typeof _deleted === 'boolean' ? _deleted : false;

        if (typeof _deleted !== 'boolean' && _deleted !== undefined) {
          logger.warn('Invalid _deleted field type', {
            id: doc.id,
            _deleted,
            type: typeof _deleted,
          });
        }

        return {
          ...rest,
          deleted,
        };
      },
    },
  });

  // 5. Monitor replication state
  // Track all subscriptions for proper cleanup
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

  // 6. Wait for initial replication with timeout
  try {
    logger.info('Waiting for initial replication...');

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Initial replication timeout')), 30000);
    });

    await Promise.race([replicationState.awaitInitialReplication(), timeoutPromise]);

    logger.info('Initial replication complete!');
  } catch (error) {
    logger.error('Initial replication failed', { error });
    // Continue anyway - live sync will catch up
    logger.info('Falling back to optimistic UI');
  }

  // 7. Cleanup function to purge all storage
  let isCleaningUp = false;

  const cleanup = async () => {
    // Prevent concurrent cleanup execution
    if (isCleaningUp) {
      logger.warn('Cleanup already in progress, skipping');
      return;
    }

    isCleaningUp = true;
    logger.info('Cleaning up and removing storage...');

    try {
      // Step 1: Unsubscribe from all RxJS subscriptions
      logger.info('Unsubscribing from RxJS subscriptions...');
      for (const subscription of subscriptions) {
        try {
          subscription.unsubscribe();
        } catch (error) {
          logger.error('Failed to unsubscribe', { error });
        }
      }

      // Step 2: Unsubscribe from Convex change stream
      logger.info('Unsubscribing from Convex change stream...');
      if (unsubscribeChangeStream) {
        try {
          unsubscribeChangeStream();
        } catch (error) {
          logger.error('Failed to unsubscribe from change stream', { error });
        }
      }

      // Step 3: Cancel replication
      logger.info('Cancelling replication...');
      try {
        await replicationState.cancel();
      } catch (error) {
        logger.error('Failed to cancel replication', { error });
      }

      // Step 4: Close ConvexClient connection if available
      logger.info('Closing ConvexClient connection...');
      if (convexClient && typeof convexClient.close === 'function') {
        try {
          convexClient.close();
        } catch (error) {
          logger.error('Failed to close ConvexClient', { error });
        }
      }

      // Step 5: Remove the database completely (this closes it and removes all data)
      logger.info('Removing database...');
      try {
        await db.remove();
      } catch (error) {
        logger.error('Failed to remove database', { error });
      }

      // Step 6: Also remove from storage layer to ensure complete cleanup
      logger.info('Removing from storage layer...');
      try {
        await removeRxDatabase(databaseName, getStorage(config.storage));
      } catch (error) {
        logger.error('Failed to remove from storage layer', { error });
      }

      logger.info('Storage removed successfully');
    } finally {
      // Always reset flag, even if cleanup fails
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
