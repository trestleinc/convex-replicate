import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStorageLocalstorage } from 'rxdb/plugins/storage-localstorage';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { replicateRxCollection } from 'rxdb/plugins/replication';
import { Subject } from 'rxjs';
import { convexClient } from './router';
import { api } from '../convex/_generated/api';

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
      maxLength: 100
    },
    text: {
      type: 'string'
    },
    isCompleted: {
      type: 'boolean'
    },
    updatedTime: {
      type: 'number',
      minimum: 0, // Required for number fields used in indexes
      maximum: 8640000000000000, // JavaScript Date max value
      multipleOf: 1 // Required for number fields used in indexes
    },
    _deleted: {
      type: 'boolean'
    }
  },
  required: ['id', 'text', 'isCompleted', 'updatedTime'],
  indexes: [
    ['updatedTime', 'id'] // Composite index for replication checkpoints
  ]
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
      storage: getRxStorageLocalstorage()
    }),
    multiInstance: true, // Enable cross-tab synchronization
    eventReduce: true, // Performance optimization
    cleanupPolicy: {} // Let RxDB handle cleanup
  });

  // Add the tasks collection
  await database.addCollections({
    tasks: {
      schema: taskSchema
    }
  });

  return database;
}

// Set up RxDB replication with Convex WebSocket client
export async function setupReplication(db: any) {
  if (!convexClient) {
    console.error('Convex client not initialized');
    return null;
  }

  // Create a Subject for the pull stream (WebSocket-based real-time updates)
  const pullStream$ = new Subject<any>();
  
  // Set up watchQuery for real-time updates via WebSocket
  let unsubscribeWatchQuery: (() => void) | null = null;
  
  function setupWatchQuery() {
    if (unsubscribeWatchQuery) {
      unsubscribeWatchQuery();
    }
    
    // Watch for changes in the tasks collection
    const watch = convexClient.watchQuery(api.tasks.pullDocuments, {
      checkpointId: '',
      checkpointTime: 0,
      limit: 100
    });
    
    const unsubscribeFn = watch.onUpdate(() => {
      console.log('Convex data updated via WebSocket - triggering RxDB sync');
      pullStream$.next('RESYNC');
    });
    
    unsubscribeWatchQuery = unsubscribeFn;
    console.log('Real-time WebSocket connection established with Convex');
  }
  
  // Start WebSocket connection
  setupWatchQuery();

  // Configure replication
  const replicationState = replicateRxCollection({
    collection: db.tasks,
    replicationIdentifier: 'tasks-convex-replication',
    live: true,
    retryTime: 5000,
    autoStart: true,
    waitForLeadership: true,
    
    pull: {
      async handler(checkpointOrNull, batchSize) {
        const checkpoint = checkpointOrNull as { id: string; updatedTime: number } || { id: '', updatedTime: 0 };
        
        try {
          // Use Convex client query instead of HTTP fetch
          const documents = await convexClient.query(api.tasks.pullDocuments, {
            checkpointId: checkpoint.id || '',
            checkpointTime: checkpoint.updatedTime || 0,
            limit: batchSize
          });
          
          // Ensure documents have _deleted property for RxDB replication
          const documentsWithDeleted = documents.map((doc: any) => ({
            ...doc,
            _deleted: doc._deleted || false
          }));
          
          // Calculate new checkpoint from returned documents
          const newCheckpoint = documentsWithDeleted.length === 0 
            ? checkpoint 
            : {
                id: documentsWithDeleted[documentsWithDeleted.length - 1].id,
                updatedTime: documentsWithDeleted[documentsWithDeleted.length - 1].updatedTime
              };
          
          console.log(`Pulled ${documentsWithDeleted.length} documents via WebSocket`);
          return {
            documents: documentsWithDeleted,
            checkpoint: newCheckpoint
          };
        } catch (error) {
          console.error('Pull handler error:', error);
          throw error;
        }
      },
      batchSize: 100,
      stream$: pullStream$.asObservable()
    },
    
    push: {
      async handler(changeRows) {
        try {
          // Use Convex client mutation instead of HTTP fetch
          const conflicts = await convexClient.mutation(api.tasks.pushDocuments, {
            changeRows
          });
          
          // Ensure conflicts have _deleted property
          const conflictsWithDeleted = conflicts.map((conflict: any) => ({
            ...conflict,
            _deleted: conflict._deleted || false
          }));
          
          console.log(`Pushed ${changeRows.length} changes via WebSocket, ${conflictsWithDeleted.length} conflicts`);
          return conflictsWithDeleted;
        } catch (error) {
          console.error('Push handler error:', error);
          throw error;
        }
      },
      batchSize: 50
    }
  });

  // Monitor replication state
  replicationState.error$.subscribe(error => {
    console.error('Replication error:', error);
  });
  
  replicationState.active$.subscribe(active => {
    console.log('Replication active:', active);
  });

  // Clean up on window unload
  window.addEventListener('beforeunload', () => {
    if (unsubscribeWatchQuery) {
      unsubscribeWatchQuery();
    }
    replicationState.cancel();
  });

  return replicationState;
}

// Initialize database and replication
export async function initializeDatabase() {
  try {
    const db = await getDatabase();
    const replication = await setupReplication(db);
    
    console.log('Database initialized successfully');
    
    return { db, replication };
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}