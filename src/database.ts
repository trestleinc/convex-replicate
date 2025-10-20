import { addRxPlugin, createRxDatabase } from 'rxdb';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { replicateRxCollection } from 'rxdb/plugins/replication';
import { getRxStorageLocalstorage } from 'rxdb/plugins/storage-localstorage';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import { Subject } from 'rxjs';
import { api } from '../convex/_generated/api';
import { convexClient } from './router';

// Add dev mode plugin for development
if (import.meta.env.DEV) {
  addRxPlugin(RxDBDevModePlugin);
}

// Task type matching our current implementation
export type Task = {
  id: string;
  text: string;
  isCompleted: boolean;
  updatedTime: number;
  _deleted?: boolean; // For soft deletes in RxDB
};

// RxDB schema for tasks
const taskSchema = {
  title: 'Task Schema',
  version: 0,
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: {
      type: 'string',
      maxLength: 100,
    },
    text: {
      type: 'string',
    },
    isCompleted: {
      type: 'boolean',
    },
    updatedTime: {
      type: 'number',
      minimum: 0, // Required for number fields used in indexes
      maximum: 8640000000000000, // JavaScript Date max value
      multipleOf: 1, // Required for number fields used in indexes
    },
    _deleted: {
      type: 'boolean',
    },
  },
  required: ['id', 'text', 'isCompleted', 'updatedTime'],
  indexes: [
    ['updatedTime', 'id'], // Composite index for replication checkpoints
  ],
} as const;

// Database instance (singleton)
let database: any = null;

export async function getDatabase() {
  if (database) {
    return database;
  }

  // Create RxDB database with LocalStorage storage and validation
  database = await createRxDatabase({
    name: 'tasksdb',
    storage: wrappedValidateAjvStorage({
      storage: getRxStorageLocalstorage(),
    }),
    multiInstance: true, // Enable cross-tab synchronization
    eventReduce: true, // Performance optimization
    cleanupPolicy: {}, // Let RxDB handle cleanup
    ignoreDuplicate: import.meta.env.DEV, // Prevent hot reload errors in development
  });

  // Add the tasks collection
  await database.addCollections({
    tasks: {
      schema: taskSchema,
    },
  });

  return database;
}

// Set up RxDB replication with Convex WebSocket client
export async function setupReplication(db: any) {
  if (!convexClient) {
    return null;
  }

  // Create a Subject for the pull stream (WebSocket-based real-time updates)
  const pullStream$ = new Subject<any>();

  // Simple WebSocket change detection
  let unsubscribeWatchQuery: (() => void) | null = null;
  let replicationState: any = null;
  let lastKnownState = { timestamp: 0, count: 0 };

  function setupWatchQuery() {
    if (unsubscribeWatchQuery) {
      unsubscribeWatchQuery();
    }

    const changeWatch = convexClient.watchQuery(api.tasks.changeStream);

    const unsubscribeFn = changeWatch.onUpdate(() => {
      const data = changeWatch.localQueryResult();

      if (
        data &&
        (data.timestamp !== lastKnownState.timestamp || data.count !== lastKnownState.count)
      ) {
        lastKnownState = { timestamp: data.timestamp, count: data.count };

        // Trigger RxDB sync
        pullStream$.next('RESYNC');
      }
    });

    unsubscribeWatchQuery = unsubscribeFn;
  }

  // Start WebSocket connection with retry logic
  const startWebSocketWithRetry = (retryCount = 0) => {
    try {
      setupWatchQuery();
    } catch (_error) {
      if (retryCount < 3) {
        setTimeout(() => startWebSocketWithRetry(retryCount + 1), 2000);
      }
    }
  };

  startWebSocketWithRetry();

  // Configure replication
  replicationState = replicateRxCollection({
    collection: db.tasks,
    replicationIdentifier: 'tasks-convex-replication',
    live: true,
    retryTime: 5000,
    autoStart: true,
    waitForLeadership: true,

    pull: {
      async handler(checkpointOrNull, batchSize) {
        const checkpointTime = (checkpointOrNull as { updatedTime: number })?.updatedTime || 0;

        try {
          const documents = await convexClient.query(api.tasks.pullDocuments, {
            checkpointTime,
            limit: batchSize,
          });

          if (!Array.isArray(documents)) {
            return { documents: [], checkpoint: { updatedTime: checkpointTime } };
          }

          // Add _deleted field and create checkpoint
          const processedDocs = documents.map((doc) => ({ ...doc, _deleted: false }));
          const newCheckpoint =
            processedDocs.length > 0
              ? { updatedTime: processedDocs[0].updatedTime } // Most recent (desc order)
              : { updatedTime: checkpointTime };
          return {
            documents: processedDocs,
            checkpoint: newCheckpoint,
          };
        } catch (_error) {
          return { documents: [], checkpoint: { updatedTime: checkpointTime } };
        }
      },
      batchSize: 100,
      stream$: pullStream$.asObservable(),
    },

    push: {
      async handler(changeRows) {
        if (!convexClient) {
          throw new Error('Convex client not available');
        }
        const conflicts = await convexClient.mutation(api.tasks.pushDocuments, {
          changeRows,
        });

        // Validate conflicts response
        if (!Array.isArray(conflicts)) {
          return [];
        }

        // Ensure conflicts have _deleted property
        const conflictsWithDeleted = conflicts
          .map((conflict: any) => {
            if (!conflict || typeof conflict !== 'object') {
              return null;
            }

            return {
              id: conflict.id,
              text: conflict.text,
              isCompleted: conflict.isCompleted,
              updatedTime: conflict.updatedTime,
              _deleted: conflict._deleted || false,
            };
          })
          .filter((conflict) => conflict !== null);
        return conflictsWithDeleted;
      },
      batchSize: 50,
    },
  });

  // Monitor replication state with detailed logging
  replicationState.error$.subscribe((_error: any) => {});

  replicationState.active$.subscribe((_active: boolean) => {});

  // Monitor replication statistics
  replicationState.received$.subscribe((_received: any) => {});

  replicationState.sent$.subscribe((_sent: any) => {});

  // Monitor replication state changes
  replicationState.remoteEvents$.subscribe((_event: any) => {});

  // Replication monitoring setup complete

  // Clean up on window unload
  window.addEventListener('beforeunload', () => {
    if (unsubscribeWatchQuery) {
      unsubscribeWatchQuery();
    }
    if (replicationState) {
      replicationState.cancel();
    }
  });

  return replicationState;
}

// Initialize database and replication
export async function initializeDatabase() {
  const db = await getDatabase();

  const replication = await setupReplication(db);
  // Database initialization complete

  return { db, replication };
}
