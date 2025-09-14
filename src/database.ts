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
  
  // Set up watchQuery for real-time updates via WebSocket
  let unsubscribeWatchQuery: (() => void) | null = null;
  let lastKnownTasksData: any = null;
  let replicationState: any = null; // Will store reference for reSync() method
  let syncTimeout: NodeJS.Timeout | null = null; // For debouncing sync triggers
  
  function setupWatchQuery() {
    if (unsubscribeWatchQuery) {
      console.log('[WebSocket] Cleaning up previous watch query');
      unsubscribeWatchQuery();
    }
    
    console.log('[WebSocket] Setting up watch query for tasks.get');
    
    // Watch for changes in the actual tasks data (not the replication query)
    const watch = convexClient.watchQuery(api.tasks.get, {});
    
    const unsubscribeFn = watch.onUpdate(() => {
      console.log('[WebSocket] Convex tasks data updated via WebSocket');
      
      // Get the current data to check if it actually changed
      const currentTasksData = watch.localQueryResult();
      console.log('[WebSocket] Current tasks data:', currentTasksData);
      
      // Only trigger sync if data actually changed (avoid infinite loops)
      if (JSON.stringify(currentTasksData) !== JSON.stringify(lastKnownTasksData)) {
        console.log('[WebSocket] Data actually changed - scheduling debounced sync trigger');
        lastKnownTasksData = currentTasksData;
        
        // Clear any existing timeout to debounce rapid triggers
        if (syncTimeout) {
          clearTimeout(syncTimeout);
        }
        
        // Debounce the sync trigger to prevent rapid-fire updates
        syncTimeout = setTimeout(() => {
          console.log('[WebSocket] Triggering RESYNC via pull stream');
          // Use the official RESYNC signal as documented in RxDB
          pullStream$.next('RESYNC');
          
          // Alternative approach: also call reSync() method as fallback
          if (replicationState && typeof replicationState.reSync === 'function') {
            console.log('[WebSocket] Also triggering reSync() method');
            replicationState.reSync();
          }
          syncTimeout = null;
        }, 150); // 150ms debounce
      } else {
        console.log('[WebSocket] Data unchanged - skipping sync trigger');
      }
    });
    
    // Handle connection state changes
    watch.onUpdate(() => {
      // Note: watch.isLoading may not be available in all Convex client versions
      console.log(`[WebSocket] Watch query updated`);
    });
    
    unsubscribeWatchQuery = unsubscribeFn;
    console.log('[WebSocket] Real-time WebSocket connection established with Convex');
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
        const checkpoint = checkpointOrNull as { id: string; updatedTime: number } || { id: '', updatedTime: 0 };
        
        console.log(`[RxDB] Pull handler called with checkpoint: {id: "${checkpoint.id}", time: ${checkpoint.updatedTime}}, batchSize: ${batchSize}`);
        
        try {
          // Validate inputs
          if (!convexClient) {
            console.error('[RxDB] Convex client is not available');
            return {
              documents: [],
              checkpoint: checkpoint
            };
          }
          
          // Use Convex client query instead of HTTP fetch
          console.log('[RxDB] Calling Convex pullDocuments...');
          const documents = await convexClient.query(api.tasks.pullDocuments, {
            checkpointId: checkpoint.id || '',
            checkpointTime: checkpoint.updatedTime || 0,
            limit: batchSize
          });
          
          console.log(`[RxDB] Convex returned:`, documents);
          
          // Comprehensive validation of response
          if (!documents) {
            console.warn('[RxDB] Convex returned null/undefined documents, using empty array');
            return {
              documents: [],
              checkpoint: checkpoint
            };
          }
          
          if (!Array.isArray(documents)) {
            console.error('[RxDB] Convex returned non-array documents:', typeof documents, documents);
            return {
              documents: [],
              checkpoint: checkpoint
            };
          }
          
          // Ensure documents is always an array and has _deleted property
          const documentsWithDeleted = documents
            .filter(doc => doc && typeof doc === 'object') // Filter out invalid documents
            .map((doc: any) => {
              // Validate document structure
              if (!doc.id || typeof doc.id !== 'string') {
                console.warn('[RxDB] Document missing or invalid id:', doc);
                return null;
              }
              
              return {
                id: doc.id,
                text: typeof doc.text === 'string' ? doc.text : '',
                isCompleted: typeof doc.isCompleted === 'boolean' ? doc.isCompleted : false,
                updatedTime: typeof doc.updatedTime === 'number' ? doc.updatedTime : Date.now(),
                _deleted: doc._deleted || false
              };
            })
            .filter(doc => doc !== null); // Remove invalid documents
          
          // Calculate new checkpoint from returned documents
          const newCheckpoint = documentsWithDeleted.length === 0 
            ? checkpoint 
            : {
                id: documentsWithDeleted[documentsWithDeleted.length - 1].id,
                updatedTime: documentsWithDeleted[documentsWithDeleted.length - 1].updatedTime
              };
          
          console.log(`[RxDB] Successfully processed ${documentsWithDeleted.length} documents, new checkpoint:`, newCheckpoint);
          
          return {
            documents: documentsWithDeleted,
            checkpoint: newCheckpoint
          };
        } catch (error) {
          console.error('[RxDB] Pull handler error:', error);
          console.error('[RxDB] Error details:', {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            checkpoint,
            batchSize
          });
          
          // Return empty result instead of throwing to prevent replication crashes
          return {
            documents: [],
            checkpoint: checkpoint
          };
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
    if (syncTimeout) {
      clearTimeout(syncTimeout);
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