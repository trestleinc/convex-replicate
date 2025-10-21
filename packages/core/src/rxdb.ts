import {
  addRxPlugin,
  createRxDatabase,
  removeRxDatabase,
  type RxCollection,
  type RxDatabase,
} from 'rxdb';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { replicateRxCollection } from 'rxdb/plugins/replication';
import { getRxStorageLocalstorage } from 'rxdb/plugins/storage-localstorage';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import { Subject } from 'rxjs';
import type { RxJsonSchema } from './types';

// Add required plugins
addRxPlugin(RxDBUpdatePlugin);

// Conditionally add dev mode plugin
try {
  if (process.env.NODE_ENV === 'development') {
    addRxPlugin(RxDBDevModePlugin);
  }
} catch (_error) {
  // process.env might not be available in all environments
}

// ========================================
// TYPE DEFINITIONS
// ========================================

export interface ConvexRxDBConfig<T> {
  databaseName: string;
  collectionName: string;
  schema: RxJsonSchema<T>;
  convexClient: any;
  convexApi: {
    changeStream: any;
    pullDocuments: any;
    pushDocuments: any;
  };
  batchSize?: number;
  enableLogging?: boolean;
}

/**
 * Instance returned by createConvexRxDB containing RxDB primitives
 */
export interface ConvexRxDBInstance<T extends object = any> {
  /** RxDB database instance */
  rxDatabase: RxDatabase;
  /** RxDB collection instance typed with document type T */
  rxCollection: RxCollection<T>;
  /** RxDB replication state with observables (error$, active$, received$, sent$) */
  replicationState: any;
  /** Cleanup function to cancel replication and remove database */
  cleanup: () => Promise<void>;
}

// ========================================
// MAIN API: CREATE CONVEX RXDB
// ========================================

export async function createConvexRxDB<T extends object>(
  config: ConvexRxDBConfig<T>
): Promise<ConvexRxDBInstance<T>> {
  const {
    databaseName,
    collectionName,
    schema,
    convexClient,
    convexApi,
    enableLogging = true,
  } = config;

  if (enableLogging) {
    console.log(`[${collectionName}] Creating RxDB database: ${databaseName}`);
  }

  // 1. Create RxDB database
  const db = await createRxDatabase({
    name: databaseName,
    storage: wrappedValidateAjvStorage({
      storage: getRxStorageLocalstorage(),
    }),
    multiInstance: true,
    eventReduce: true,
    ignoreDuplicate: process.env.NODE_ENV === 'development',
  });

  // 2. Add collection with schema
  // Extend schema to include _deleted field for soft deletes
  const schemaWithDeleted: RxJsonSchema<T & { _deleted?: boolean }> = {
    ...schema,
    properties: {
      ...schema.properties,
      _deleted: {
        type: 'boolean',
      },
    },
  };

  const collections = await db.addCollections({
    [collectionName]: {
      schema: schemaWithDeleted,
    },
  });

  const rxCollection = collections[collectionName];

  if (enableLogging) {
    console.log(`[${collectionName}] RxDB collection created`);
  }

  // 3. Set up WebSocket stream for real-time updates
  const pullStream$ = new Subject<'RESYNC' | any>();
  let lastKnownState = { timestamp: 0, count: 0 };
  let unsubscribeChangeStream: (() => void) | null = null;

  function setupChangeStream() {
    if (enableLogging) {
      console.log(`[${collectionName}] Setting up Convex change stream`);
    }

    try {
      const changeWatch = convexClient.watchQuery(convexApi.changeStream, {});

      // Trigger initial sync
      pullStream$.next('RESYNC');

      const unsubscribe = changeWatch.onUpdate(() => {
        const data = changeWatch.localQueryResult();
        if (
          data &&
          (data.timestamp !== lastKnownState.timestamp || data.count !== lastKnownState.count)
        ) {
          if (enableLogging) {
            console.log(`[${collectionName}] Change detected:`, data);
          }
          lastKnownState = { timestamp: data.timestamp, count: data.count };
          pullStream$.next('RESYNC');
        }
      });

      unsubscribeChangeStream = unsubscribe;
    } catch (error) {
      console.error(`[${collectionName}] Failed to setup change stream:`, error);
    }
  }

  setupChangeStream();

  // 4. Set up RxDB replication using native replicateRxCollection
  const replicationState = replicateRxCollection({
    collection: rxCollection,
    replicationIdentifier: `convex-${collectionName}`,
    live: true,
    retryTime: 5000,
    autoStart: true,
    waitForLeadership: false,

    pull: {
      async handler(checkpointOrNull, batchSize) {
        const checkpoint = checkpointOrNull || { id: '', updatedTime: 0 };

        if (enableLogging) {
          console.log(`[${collectionName}] Pull from checkpoint:`, checkpoint);
        }

        try {
          const result = await convexClient.query(convexApi.pullDocuments, {
            checkpoint,
            limit: batchSize,
          });

          if (enableLogging) {
            console.log(
              `[${collectionName}] Pulled ${result.documents.length} documents, new checkpoint:`,
              result.checkpoint
            );
            console.log(`[${collectionName}] Raw documents from Convex:`, result.documents);
          }

          return {
            documents: result.documents,
            checkpoint: result.checkpoint,
          };
        } catch (error) {
          console.error(`[${collectionName}] Pull error:`, error);
          return {
            documents: [],
            checkpoint: checkpoint,
          };
        }
      },
      batchSize: config.batchSize || 100,
      stream$: pullStream$.asObservable(),
      // Transform Convex's 'deleted' field to RxDB's '_deleted' field
      modifier: (doc: any) => {
        if (!doc) return doc;
        const { deleted, ...rest } = doc;
        const transformed = {
          ...rest,
          _deleted: deleted || false,
        };

        if (enableLogging && deleted) {
          console.log(`[${collectionName}] Pull modifier - Transforming deleted doc:`, {
            from: doc,
            to: transformed,
          });
        }

        return transformed;
      },
    },

    push: {
      async handler(changeRows) {
        if (enableLogging) {
          console.log(`[${collectionName}] Pushing ${changeRows.length} changes`);
        }

        try {
          const conflicts = await convexClient.mutation(convexApi.pushDocuments, {
            changeRows,
          });

          if (enableLogging && conflicts && conflicts.length > 0) {
            console.log(`[${collectionName}] Conflicts detected:`, conflicts.length);
          }

          return conflicts || [];
        } catch (error) {
          console.error(`[${collectionName}] Push error:`, error);
          return [];
        }
      },
      batchSize: 50,
      // Transform RxDB's '_deleted' field to Convex's 'deleted' field before sending
      modifier: (doc: any) => {
        if (!doc) return doc;
        const { _deleted, ...rest } = doc;
        return {
          ...rest,
          deleted: _deleted || false,
        };
      },
    },
  });

  // 5. Monitor replication state
  if (enableLogging) {
    replicationState.error$.subscribe((error: any) => {
      console.error(`[${collectionName}] Replication error:`, error);
    });

    replicationState.active$.subscribe((active: boolean) => {
      console.log(`[${collectionName}] Replication active:`, active);
    });

    replicationState.received$.subscribe((doc: any) => {
      console.log(`[${collectionName}] Received doc:`, {
        id: doc.id,
        _deleted: doc._deleted,
        fullDoc: doc,
      });
    });

    replicationState.sent$.subscribe((doc: any) => {
      console.log(`[${collectionName}] Sent doc:`, {
        id: doc.id,
        _deleted: doc._deleted,
        fullDoc: doc,
      });
    });
  }

  // 6. Wait for initial replication
  try {
    if (enableLogging) {
      console.log(`[${collectionName}] Waiting for initial replication...`);
    }
    await replicationState.awaitInitialReplication();
    if (enableLogging) {
      console.log(`[${collectionName}] Initial replication complete!`);
    }
  } catch (error) {
    console.error(`[${collectionName}] Initial replication failed:`, error);
    // Continue anyway - live sync will catch up
  }

  // 7. Cleanup function to purge all storage
  const cleanup = async () => {
    if (enableLogging) {
      console.log(`[${collectionName}] Cleaning up and removing storage...`);
    }

    // Unsubscribe from change stream
    if (unsubscribeChangeStream) {
      unsubscribeChangeStream();
    }

    // Cancel replication
    await replicationState.cancel();

    // Remove the database completely (this closes it and removes all data)
    await db.remove();

    // Also remove from storage layer to ensure complete cleanup
    await removeRxDatabase(
      databaseName,
      wrappedValidateAjvStorage({
        storage: getRxStorageLocalstorage(),
      })
    );

    if (enableLogging) {
      console.log(`[${collectionName}] Storage removed successfully`);
    }
  };

  return {
    rxDatabase: db,
    rxCollection,
    replicationState,
    cleanup,
  };
}
