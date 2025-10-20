import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStorageLocalstorage } from 'rxdb/plugins/storage-localstorage';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';
import { replicateRxCollection } from 'rxdb/plugins/replication';
import { Subject } from 'rxjs';
import type { ConvexSyncConfig, RxJsonSchema, ConvexRxSyncInstance } from './types';

// Add required plugins
addRxPlugin(RxDBUpdatePlugin);

// Conditionally add dev mode plugin (check for development environment)
try {
  if (process.env.NODE_ENV === 'development') {
    addRxPlugin(RxDBDevModePlugin);
  }
} catch (error) {
  // process.env might not be available in all environments
}

// ========================================
// DATABASE MANAGEMENT (Singleton Pattern)
// ========================================

const databaseInstances = new Map<string, Promise<any>>();

async function getOrCreateDatabase(name: string): Promise<any> {
  if (databaseInstances.has(name)) {
    return databaseInstances.get(name)!;
  }

  const isDev = process.env.NODE_ENV === 'development';

  const dbPromise = createRxDatabase({
    name,
    storage: wrappedValidateAjvStorage({
      storage: getRxStorageLocalstorage()
    }),
    multiInstance: true, // Enable cross-tab synchronization
    eventReduce: true, // Performance optimization
    cleanupPolicy: {}, // Let RxDB handle cleanup
    ignoreDuplicate: isDev, // Prevent hot reload errors in development
  });

  databaseInstances.set(name, dbPromise);
  return dbPromise;
}

// ========================================
// SCHEMA UTILITIES
// ========================================

function createBaseSchema<T>(tableName: string, userSchema: RxJsonSchema<T>): RxJsonSchema<T & { _deleted?: boolean }> {
  return {
    ...userSchema,
    title: `${tableName} Schema`,
    properties: {
      ...userSchema.properties,
      _deleted: {
        type: 'boolean'
      }
    },
    indexes: [
      ['updatedTime', 'id'], // For efficient replication checkpoints
      ...(userSchema.indexes || [])
    ]
  };
}

// ========================================
// REPLICATION SETUP
// ========================================

async function setupReplication<T>(
  collection: any,
  tableName: string,
  config: ConvexSyncConfig<T>
): Promise<any> {
  const { convexClient } = config;

  if (!convexClient) {
    console.error(`[${tableName}] Convex client not provided`);
    return null;
  }

  const pullStream$ = new Subject<any>();
  const batchSize = config.batchSize || 100;
  const retryTime = config.retryTime || 5000;
  const enableLogging = config.enableLogging !== false;

  // WebSocket change detection for real-time updates
  let unsubscribeWatchQuery: (() => void) | null = null;
  let lastKnownState = { timestamp: 0, count: 0 };

  function setupWatchQuery() {
    if (unsubscribeWatchQuery) {
      unsubscribeWatchQuery();
    }

    if (enableLogging) {
      console.log(`[${tableName}] Setting up change stream watch`);
    }

    try {
      const changeWatch = convexClient.watchQuery(config.convexApi.changeStream, {});

      const unsubscribeFn = changeWatch.onUpdate(() => {
        const data = changeWatch.localQueryResult();

        if (data && (data.timestamp !== lastKnownState.timestamp || data.count !== lastKnownState.count)) {
          if (enableLogging) {
            console.log(`[${tableName}] Change detected: ${lastKnownState.timestamp},${lastKnownState.count} → ${data.timestamp},${data.count}`);
          }
          lastKnownState = { timestamp: data.timestamp, count: data.count };

          // Trigger RxDB sync
          pullStream$.next('RESYNC');
        }
      });

      unsubscribeWatchQuery = unsubscribeFn;
    } catch (error) {
      console.error(`[${tableName}] Failed to setup watch query:`, error);
    }
  }

  // Start WebSocket connection with retry logic
  const startWebSocketWithRetry = (retryCount = 0) => {
    try {
      setupWatchQuery();
    } catch (error) {
      console.error(`[${tableName}] Failed to setup watch query:`, error);
      if (retryCount < 3) {
        if (enableLogging) {
          console.log(`[${tableName}] Retrying in 2s... (attempt ${retryCount + 1}/3)`);
        }
        setTimeout(() => startWebSocketWithRetry(retryCount + 1), 2000);
      }
    }
  };

  startWebSocketWithRetry();

  // Configure replication
  const replicationState = replicateRxCollection({
    collection,
    replicationIdentifier: `${tableName}-convex-replication`,
    live: true,
    retryTime,
    autoStart: true,
    waitForLeadership: true,

    pull: {
      async handler(checkpointOrNull, batchSizeParam) {
        const checkpointTime = (checkpointOrNull as { updatedTime: number })?.updatedTime || 0;

        if (enableLogging) {
          console.log(`[${tableName}] Pull: checkpoint=${checkpointTime}, batch=${batchSizeParam}`);
        }

        try {
          const documents = await convexClient.query(config.convexApi.pullDocuments, {
            checkpointTime,
            limit: batchSizeParam
          });

          if (!Array.isArray(documents)) {
            return { documents: [], checkpoint: { updatedTime: checkpointTime } };
          }

          // Add _deleted field and create checkpoint
          const processedDocs = documents.map(doc => ({ ...doc, _deleted: false }));
          const newCheckpoint = processedDocs.length > 0
            ? { updatedTime: processedDocs[0].updatedTime }
            : { updatedTime: checkpointTime };

          if (enableLogging) {
            console.log(`[${tableName}] Pulled ${processedDocs.length} documents`);
          }

          return {
            documents: processedDocs,
            checkpoint: newCheckpoint
          };
        } catch (error) {
          console.error(`[${tableName}] Pull error:`, error);
          return { documents: [], checkpoint: { updatedTime: checkpointTime } };
        }
      },
      batchSize,
      stream$: pullStream$.asObservable()
    },

    push: {
      async handler(changeRows) {
        if (enableLogging) {
          console.log(`[${tableName}] Push handler called with ${changeRows.length} change rows`);
        }

        try {
          const conflicts = await convexClient.mutation(config.convexApi.pushDocuments, {
            changeRows
          });

          if (enableLogging) {
            console.log(`[${tableName}] Push completed with ${Array.isArray(conflicts) ? conflicts.length : 'invalid'} conflicts`);
          }

          // Validate conflicts response
          if (!Array.isArray(conflicts)) {
            console.error(`[${tableName}] Convex returned non-array conflicts:`, typeof conflicts, conflicts);
            return [];
          }

          // Ensure conflicts have _deleted property
          const conflictsWithDeleted = conflicts.map((conflict: any) => {
            if (!conflict || typeof conflict !== 'object') {
              console.warn(`[${tableName}] Invalid conflict object:`, conflict);
              return null;
            }

            return {
              ...conflict,
              _deleted: conflict._deleted || false
            };
          }).filter(conflict => conflict !== null);

          return conflictsWithDeleted;
        } catch (error) {
          console.error(`[${tableName}] Push handler error:`, error);
          throw error;
        }
      },
      batchSize: 50
    }
  });

  // Monitor replication state with detailed logging
  if (enableLogging) {
    replicationState.error$.subscribe((error: any) => {
      console.error(`[${tableName}] Replication error:`, error);
    });

    replicationState.active$.subscribe((active: boolean) => {
      console.log(`[${tableName}] Replication active: ${active}`);
    });

    replicationState.received$.subscribe((received: any) => {
      console.log(`[${tableName}] Received batch:`, received);
    });

    replicationState.sent$.subscribe((sent: any) => {
      console.log(`[${tableName}] Sent batch:`, sent);
    });
  }

  // Clean up on window unload (browser environment only)
  if (typeof window !== 'undefined') {
    const cleanup = () => {
      if (unsubscribeWatchQuery) {
        unsubscribeWatchQuery();
      }
      if (replicationState) {
        replicationState.cancel();
      }
    };

    window.addEventListener('beforeunload', cleanup);
  }

  return replicationState;
}

// ========================================
// MAIN API: CREATE CONVEX RX SYNC
// ========================================

export async function createConvexRxSync<T>(config: ConvexSyncConfig<T>): Promise<ConvexRxSyncInstance<T>> {
  const databaseName = config.databaseName || `${config.tableName}db`;
  const enableLogging = config.enableLogging !== false;

  try {
    if (enableLogging) {
      console.log(`[${config.tableName}] Starting sync initialization...`);
    }

    // Get or create database
    const database = await getOrCreateDatabase(databaseName);

    // Create schema with base fields
    const schema = createBaseSchema(config.tableName, config.schema);

    // Add collection if it doesn't exist
    const collections = await database.addCollections({
      [config.tableName]: { schema }
    });

    const rxCollection = collections[config.tableName];

    if (enableLogging) {
      console.log(`[${config.tableName}] Database and collection created`);
    }

    // Setup replication
    const replicationState = await setupReplication(rxCollection, config.tableName, config);

    if (enableLogging) {
      console.log(`[${config.tableName}] Sync initialization complete`);
    }

    return {
      rxDatabase: database,
      rxCollection,
      replicationState,
      tableName: config.tableName
    };

  } catch (error) {
    console.error(`[${config.tableName}] Failed to initialize sync:`, error);
    throw error;
  }
}

// ========================================
// CLEANUP UTILITIES
// ========================================

export function createCleanupFunction() {
  return () => {
    // Clean up all database instances
    databaseInstances.forEach(async (dbPromise, name) => {
      try {
        const db = await dbPromise;
        await db.destroy();
        console.log(`[Cleanup] Database ${name} destroyed`);
      } catch (error) {
        console.error(`[Cleanup] Failed to destroy database ${name}:`, error);
      }
    });
    databaseInstances.clear();
  };
}
