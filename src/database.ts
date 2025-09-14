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
    cleanupPolicy: {}, // Let RxDB handle cleanup
    ignoreDuplicate: import.meta.env.DEV, // Prevent hot reload errors in development
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
  
  // Simple WebSocket change detection
  let unsubscribeWatchQuery: (() => void) | null = null;
  let replicationState: any = null;
  let lastKnownState = { timestamp: 0, count: 0 };
  
  function setupWatchQuery() {
    if (unsubscribeWatchQuery) {
      unsubscribeWatchQuery();
    }
    
    console.log('[WebSocket] Setting up change stream watch');
    
    const changeWatch = convexClient.watchQuery(api.tasks.changeStream);
    
    const unsubscribeFn = changeWatch.onUpdate(() => {
      const data = changeWatch.localQueryResult();
      
      if (data && (data.timestamp !== lastKnownState.timestamp || data.count !== lastKnownState.count)) {
        console.log(`[WebSocket] Change detected: ${lastKnownState.timestamp},${lastKnownState.count} → ${data.timestamp},${data.count}`);
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
    } catch (error) {
      console.error('[WebSocket] Failed to setup watch query:', error);
      if (retryCount < 3) {
        console.log(`[WebSocket] Retrying in 2s... (attempt ${retryCount + 1}/3)`);
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
        
        console.log(`[RxDB] Pull: checkpoint=${checkpointTime}, batch=${batchSize}`);
        
        try {
          const documents = await convexClient.query(api.tasks.pullDocuments, {
            checkpointTime,
            limit: batchSize
          });
          
          if (!Array.isArray(documents)) {
            return { documents: [], checkpoint: { updatedTime: checkpointTime } };
          }
          
          // Add _deleted field and create checkpoint
          const processedDocs = documents.map(doc => ({ ...doc, _deleted: false }));
          const newCheckpoint = processedDocs.length > 0 
            ? { updatedTime: processedDocs[0].updatedTime } // Most recent (desc order)
            : { updatedTime: checkpointTime };
          
          console.log(`[RxDB] Pulled ${processedDocs.length} documents`);
          return {
            documents: processedDocs,
            checkpoint: newCheckpoint
          };
        } catch (error) {
          console.error('[RxDB] Pull error:', error);
          return { documents: [], checkpoint: { updatedTime: checkpointTime } };
        }
      },
      batchSize: 100,
      stream$: pullStream$.asObservable()
    },
    
    push: {
      async handler(changeRows) {
        console.log(`[RxDB] Push handler called with ${changeRows.length} change rows`);
        console.log(`[RxDB] Change rows:`, changeRows.map(row => ({
          id: row.newDocumentState.id,
          operation: row.assumedMasterState ? 'UPDATE' : 'INSERT',
          hasAssumedMaster: !!row.assumedMasterState
        })));
        
        try {
          if (!convexClient) {
            console.error('[RxDB] Convex client not available for push');
            throw new Error('Convex client not available');
          }
          
          // Use Convex client mutation instead of HTTP fetch
          console.log('[RxDB] Calling Convex pushDocuments mutation...');
          const conflicts = await convexClient.mutation(api.tasks.pushDocuments, {
            changeRows
          });
          
          console.log(`[RxDB] Convex returned ${Array.isArray(conflicts) ? conflicts.length : 'invalid'} conflicts:`, conflicts);
          
          // Validate conflicts response
          if (!Array.isArray(conflicts)) {
            console.error('[RxDB] Convex returned non-array conflicts:', typeof conflicts, conflicts);
            return [];
          }
          
          // Ensure conflicts have _deleted property
          const conflictsWithDeleted = conflicts.map((conflict: any) => {
            if (!conflict || typeof conflict !== 'object') {
              console.warn('[RxDB] Invalid conflict object:', conflict);
              return null;
            }
            
            return {
              id: conflict.id,
              text: conflict.text,
              isCompleted: conflict.isCompleted,
              updatedTime: conflict.updatedTime,
              _deleted: conflict._deleted || false
            };
          }).filter(conflict => conflict !== null);
          
          console.log(`[RxDB] Successfully pushed ${changeRows.length} changes, processed ${conflictsWithDeleted.length} conflicts`);
          return conflictsWithDeleted;
        } catch (error) {
          console.error('[RxDB] Push handler error:', error);
          console.error('[RxDB] Push error details:', {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            changeRowCount: changeRows.length
          });
          throw error;
        }
      },
      batchSize: 50
    }
  });

  // Monitor replication state with detailed logging
  replicationState.error$.subscribe((error: any) => {
    console.error('[Replication] Replication error occurred:', error);
    console.error('[Replication] Error details:', {
      message: error.message,
      stack: error.stack,
      parameters: error.parameters
    });
  });
  
  replicationState.active$.subscribe((active: boolean) => {
    console.log(`[Replication] Replication active: ${active}`);
  });
  
  // Monitor replication statistics
  replicationState.received$.subscribe((received: any) => {
    console.log(`[Replication] Received batch from remote:`, received);
  });
  
  replicationState.sent$.subscribe((sent: any) => {
    console.log(`[Replication] Sent batch to remote:`, sent);
  });
  
  // Monitor replication state changes
  replicationState.remoteEvents$.subscribe((event: any) => {
    console.log('[Replication] Remote event:', event);
  });
  
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
  try {
    console.log('[Database] Starting database initialization...');
    
    const db = await getDatabase();
    console.log('[Database] RxDB database created successfully');
    
    const replication = await setupReplication(db);
    // Database initialization complete
    
    return { db, replication };
  } catch (error) {
    console.error('[Database] Failed to initialize database:', error);
    console.error('[Database] Initialization error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}