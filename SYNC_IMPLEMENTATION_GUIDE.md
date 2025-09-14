# Complete Guide to Offline-First Sync Implementations

## Table of Contents
1. [Overview](#overview)
2. [Option 1: Simple Offline Flag](#option-1-simple-offline-flag)
3. [Option 2: Offline Queue Collection](#option-2-offline-queue-collection)
4. [Option 3: RxDB Production Implementation (Recommended)](#option-3-rxdb-production-implementation-recommended)

---

## Overview

This guide covers three approaches to implementing offline-first sync in web applications, from simple to production-ready. Each approach has trade-offs in complexity, features, and robustness.

---

## Option 1: Simple Offline Flag

### Architecture
```typescript
// Add offline flag to your data model
type Task = {
  id: string;
  text: string;
  isCompleted: boolean;
  isOfflineChange?: boolean; // Flag for offline changes
  updatedAt: number;
}
```

### Implementation

```typescript
// When creating/updating offline
const updateTaskOffline = (task: Task) => {
  const updated = {
    ...task,
    isOfflineChange: true,
    updatedAt: Date.now()
  };
  collection.update(task.id, updated);
  localStorage.setItem('tasks', JSON.stringify(getAllTasks()));
};

// Sync on reconnection
const syncOfflineChanges = async () => {
  const tasks = collection.getAll();
  const offlineTasks = tasks.filter(t => t.isOfflineChange);
  
  for (const task of offlineTasks) {
    try {
      await api.syncTask(task);
      // Clear flag after successful sync
      collection.update(task.id, { ...task, isOfflineChange: false });
    } catch (error) {
      console.error('Failed to sync task:', task.id, error);
    }
  }
};
```

### Pros & Cons
✅ **Pros:**
- Minimal code changes
- Easy to understand
- Works for simple use cases

❌ **Cons:**
- No conflict resolution
- No operation history
- Pollutes domain model
- Limited to last-write-wins

---

## Option 2: Offline Queue Collection

### Architecture
```typescript
// Separate collection for offline operations
type OfflineMutation = {
  id: string;
  type: 'insert' | 'update' | 'delete';
  entityId: string;
  entityType: string;
  data: any;
  timestamp: number;
  retries: number;
};

// Create offline queue collection
const offlineQueueCollection = createCollection(
  localOnlyCollectionOptions({
    id: "offline-queue",
    getKey: (item) => item.id,
    schema: offlineQueueSchema
  })
);
```

### Implementation

```typescript
// Queue operations when offline
const queueOfflineOperation = (operation: OfflineMutation) => {
  offlineQueueCollection.insert(operation);
};

// Process queue on reconnection
const processOfflineQueue = async () => {
  const queue = offlineQueueCollection.getAll();
  
  for (const operation of queue) {
    try {
      switch (operation.type) {
        case 'insert':
          await api.create(operation.entityType, operation.data);
          break;
        case 'update':
          await api.update(operation.entityType, operation.entityId, operation.data);
          break;
        case 'delete':
          await api.delete(operation.entityType, operation.entityId);
          break;
      }
      
      // Remove from queue on success
      offlineQueueCollection.delete(operation.id);
    } catch (error) {
      // Increment retry count
      offlineQueueCollection.update(operation.id, {
        ...operation,
        retries: operation.retries + 1
      });
    }
  }
};
```

### Pros & Cons
✅ **Pros:**
- Clean separation of concerns
- Operation history/audit trail
- Can handle complex scenarios
- Domain model stays clean

❌ **Cons:**
- More complex implementation
- Manual queue management
- No built-in conflict resolution

---

## Option 3: RxDB Production Implementation (Recommended)

### Overview
RxDB provides a battle-tested, production-ready solution for offline-first applications with built-in replication, conflict resolution, and support for various storage backends.

### Architecture

```typescript
import { createRxDatabase } from 'rxdb';
import { getRxStorageIndexedDB } from 'rxdb/plugins/storage-indexeddb';
import { replicateRxCollection } from 'rxdb/plugins/replication';

// Create database with your preferred storage
const db = await createRxDatabase({
  name: 'myapp',
  storage: getRxStorageIndexedDB(), // or SQLite, Memory, etc.
  multiInstance: true, // Sync between tabs
  eventReduce: true // Optimize performance
});

// Define schema with conflict resolution metadata
const taskSchema = {
  version: 0,
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: { type: 'string', maxLength: 100 },
    text: { type: 'string' },
    isCompleted: { type: 'boolean' },
    updatedAt: { type: 'number' },
    _deleted: { type: 'boolean' } // For soft deletes
  },
  required: ['id', 'text', 'isCompleted', 'updatedAt']
};

// Add collections
await db.addCollections({
  tasks: { schema: taskSchema }
});
```

### Server Implementation

For RxDB to work properly, your server needs to implement three endpoints:

#### 1. Pull Endpoint
Fetches documents that have changed since the last checkpoint. This endpoint is critical for initial sync and catching up after disconnections.

```typescript
// GET /api/replication/pull?checkpoint={checkpoint}&limit={limit}
app.get('/api/replication/pull', async (req, res) => {
  const { id = '', updatedAt = 0 } = req.query.checkpoint 
    ? JSON.parse(req.query.checkpoint) 
    : {};
  const limit = parseInt(req.query.limit || '100');

  // IMPORTANT: We compare both updatedAt AND id because updatedAt might not be unique
  // This ensures deterministic ordering when multiple documents have the same timestamp
  const documents = await db.collection('tasks').find({
    $or: [
      { updatedAt: { $gt: updatedAt } },
      { updatedAt: { $eq: updatedAt }, id: { $gt: id } }
    ]
  })
  .sort({ updatedAt: 1, id: 1 })
  .limit(limit);

  // Calculate new checkpoint from the last document
  const newCheckpoint = documents.length === 0 
    ? { id, updatedAt }
    : {
        id: documents[documents.length - 1].id,
        updatedAt: documents[documents.length - 1].updatedAt
      };

  res.json({
    documents,
    checkpoint: newCheckpoint
  });
});
```

#### 2. Push Endpoint
Receives changes from clients and handles conflicts. This endpoint must detect conflicts atomically and return the current server state for any conflicting documents.

```typescript
// POST /api/replication/push
app.post('/api/replication/push', async (req, res) => {
  const changeRows = req.body;
  const conflicts = [];
  const processedDocs = [];
  
  // IMPORTANT: Use database transactions to ensure atomicity
  const session = await db.startSession();
  await session.withTransaction(async () => {
    for (const changeRow of changeRows) {
      const { 
        newDocumentState, 
        assumedMasterState 
      } = changeRow;
      
      // Fetch current document state
      const currentDoc = await db.collection('tasks')
        .findOne({ id: newDocumentState.id }, { session });
      
      // Conflict detection logic
      if (
        currentDoc && !assumedMasterState ||
        (
          currentDoc && assumedMasterState &&
          currentDoc.updatedAt !== assumedMasterState.updatedAt
        )
      ) {
        // Conflict detected - return current server state
        conflicts.push(currentDoc);
      } else {
        // No conflict - apply the change
        if (newDocumentState._deleted) {
          await db.collection('tasks').deleteOne(
            { id: newDocumentState.id },
            { session }
          );
        } else {
          await db.collection('tasks').replaceOne(
            { id: newDocumentState.id },
            newDocumentState,
            { upsert: true, session }
          );
        }
        processedDocs.push(newDocumentState);
      }
    }
  });
  
  // Emit processed documents to the pull stream (if using SSE)
  if (processedDocs.length > 0 && pullStream$) {
    pullStream$.next({
      documents: processedDocs,
      checkpoint: {
        id: processedDocs[processedDocs.length - 1].id,
        updatedAt: processedDocs[processedDocs.length - 1].updatedAt
      }
    });
  }
  
  res.json(conflicts);
});
```

#### 3. Pull Stream Endpoint (Optional but Recommended)
Provides real-time updates via Server-Sent Events. This endpoint enables instant synchronization across all connected clients.

```typescript
// GET /api/replication/pull-stream
import { Subject } from 'rxjs';

// Shared stream for all connected clients
const pullStream$ = new Subject();

app.get('/api/replication/pull-stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable proxy buffering
  });

  // Send heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 30000);

  // Subscribe to the shared pull stream
  const subscription = pullStream$.subscribe(event => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    subscription.unsubscribe();
    res.end();
  });
  
  req.on('error', () => {
    clearInterval(heartbeat);
    subscription.unsubscribe();
  });
});
```

### Client Implementation

```typescript
// Start replication
const replicationState = await replicateRxCollection({
  collection: db.tasks,
  replicationIdentifier: 'my-tasks-replication',
  live: true, // Keep syncing in real-time
  retry: true, // Auto-retry on errors
  
  // Push handler
  push: {
    async handler(changeRows) {
      const response = await fetch('/api/replication/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changeRows)
      });
      
      const conflicts = await response.json();
      return conflicts;
    },
    batchSize: 50, // Push in batches
    modifier: doc => doc // Optional document transformer
  },
  
  // Pull handler
  pull: {
    async handler(checkpoint, batchSize) {
      const url = `/api/replication/pull?checkpoint=${
        encodeURIComponent(JSON.stringify(checkpoint))
      }&limit=${batchSize}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      return {
        documents: data.documents,
        checkpoint: data.checkpoint
      };
    },
    batchSize: 100, // Pull in batches
    modifier: doc => doc, // Optional document transformer
    
    // Live updates via SSE (optional)
    stream$: new Observable(subscriber => {
      const eventSource = new EventSource('/api/replication/pull-stream');
      
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        subscriber.next(data);
      };
      
      eventSource.onerror = () => {
        subscriber.error(new Error('Stream error'));
      };
      
      return () => eventSource.close();
    })
  }
});

// Monitor replication state
replicationState.error$.subscribe(error => {
  console.error('Replication error:', error);
});

replicationState.active$.subscribe(active => {
  console.log('Replication active:', active);
});
```

### Conflict Resolution

RxDB provides multiple conflict resolution strategies. The key to understanding conflict resolution is the `changeRow` structure:

```typescript
interface ChangeRow<T> {
  newDocumentState: T;        // The client's new version
  assumedMasterState: T | null; // What the client thinks is on the server
}
```

#### 1. Default Conflict Handler (First-Write-Wins)
```typescript
import { deepEqual } from 'rxdb/plugins/utils';

export const defaultConflictHandler = {
  isEqual(a, b) {
    // Deep equality check (expensive but thorough)
    return deepEqual(a, b);
  },
  resolve(input) {
    // Always use server state
    return input.realMasterState;
  }
};
```

#### 2. Custom Conflict Resolution Strategies

##### Last-Write-Wins Strategy
```typescript
const lastWriteWinsHandler = {
  isEqual(a, b) {
    // Compare timestamps for efficiency
    return a.updatedAt === b.updatedAt;
  },
  resolve(input) {
    // Choose document with latest timestamp
    if (input.newDocumentState.updatedAt > input.realMasterState.updatedAt) {
      return input.newDocumentState;
    }
    return input.realMasterState;
  }
};
```

##### Field-Level Merge Strategy
```typescript
const fieldMergeHandler = {
  isEqual(a, b) {
    return a.updatedAt === b.updatedAt && a.revision === b.revision;
  },
  async resolve(input) {
    const { realMasterState, assumedMasterState, newDocumentState } = input;
    
    // Track which fields changed
    const clientChanges = {};
    const serverChanges = {};
    
    // Detect client-side changes
    for (const key in newDocumentState) {
      if (assumedMasterState[key] !== newDocumentState[key]) {
        clientChanges[key] = newDocumentState[key];
      }
    }
    
    // Detect server-side changes
    for (const key in realMasterState) {
      if (assumedMasterState[key] !== realMasterState[key]) {
        serverChanges[key] = realMasterState[key];
      }
    }
    
    // Merge non-conflicting changes
    const merged = { ...realMasterState };
    for (const key in clientChanges) {
      if (!(key in serverChanges)) {
        // No conflict on this field
        merged[key] = clientChanges[key];
      } else {
        // Conflict - implement your logic
        // Example: concatenate strings, merge arrays, etc.
        if (Array.isArray(merged[key])) {
          merged[key] = [...new Set([...serverChanges[key], ...clientChanges[key]])];
        } else if (typeof merged[key] === 'string') {
          // For text, you might want to use a more sophisticated merge
          merged[key] = serverChanges[key]; // Or implement 3-way merge
        }
      }
    }
    
    merged.updatedAt = Date.now();
    return merged;
  }
};
```

##### Interactive Conflict Resolution
```typescript
const interactiveHandler = {
  isEqual(a, b) {
    return a.revision === b.revision;
  },
  async resolve(input) {
    // Show UI to user for manual resolution
    const resolved = await showConflictDialog({
      local: input.newDocumentState,
      server: input.realMasterState,
      base: input.assumedMasterState
    });
    
    return resolved;
  }
};
```

#### 3. CRDT-based Resolution
When using CRDTs, conflicts are automatically resolved:

```typescript
// Schema with CRDT support
const crdtSchema = {
  version: 0,
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    
    // Last-Write-Wins Register
    title: { 
      type: 'string',
      crdt: {
        type: 'lww'
      }
    },
    
    // Grow-only set
    tags: {
      type: 'array',
      crdt: {
        type: 'g-set'
      }
    },
    
    // Counter CRDT
    viewCount: {
      type: 'number',
      crdt: {
        type: 'counter'
      }
    }
  }
};

// IMPORTANT: When using CRDTs, do NOT set a custom conflictHandler
// The CRDT system handles conflicts automatically
```

#### 4. Implementing Conflict Resolution in Your App

```typescript
// Apply conflict handler to collection
const db = await createRxDatabase({
  name: 'myapp',
  storage: getRxStorageIndexedDB()
});

await db.addCollections({
  tasks: {
    schema: taskSchema,
    conflictHandler: fieldMergeHandler // Your chosen strategy
  }
});

// Monitor conflicts during replication
replicationState.error$.subscribe(error => {
  if (error.type === 'conflict') {
    console.log('Conflict detected:', error);
    // Handle or log conflicts
  }
});
```

### Advanced Features

#### 1. Attachment Handling
```typescript
// Enable attachments in schema
const schema = {
  // ... other properties
  attachments: {
    encrypted: false
  }
};

// Sync attachments
const doc = await db.tasks.findOne('task1').exec();
await doc.putAttachment({
  id: 'photo',
  data: blob,
  type: 'image/jpeg'
});
```

#### 2. Custom Headers & Authentication
```typescript
const replicationState = await replicateRxCollection({
  // ... other options
  push: {
    async handler(changeRows) {
      const response = await fetch('/api/replication/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify(changeRows)
      });
      return await response.json();
    }
  }
});
```

#### 3. Selective Sync
```typescript
// Only sync certain documents
const replicationState = await replicateRxCollection({
  // ... other options
  push: {
    async handler(changeRows) {
      // Filter what to push
      const filtered = changeRows.filter(row => 
        row.newDocumentState.syncEnabled === true
      );
      
      if (filtered.length === 0) return [];
      
      return await api.push(filtered);
    }
  },
  pull: {
    async handler(checkpoint, batchSize) {
      // Add query parameters for selective pull
      const url = `/api/replication/pull?checkpoint=${
        encodeURIComponent(JSON.stringify(checkpoint))
      }&limit=${batchSize}&userId=${getCurrentUserId()}`;
      
      const response = await fetch(url);
      return await response.json();
    }
  }
});
```

### Production Considerations

#### 1. Error Handling & Retry Logic
```typescript
const replicationState = await replicateRxCollection({
  collection: db.tasks,
  replicationIdentifier: 'production-sync',
  retryTime: 5000, // Retry after 5 seconds
  autoStart: true,
  
  push: {
    async handler(changeRows) {
      let retries = 0;
      const maxRetries = 3;
      
      while (retries < maxRetries) {
        try {
          const response = await fetch('/api/replication/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify(changeRows)
          });
          
          if (response.status === 401) {
            await refreshAuthToken();
            retries++;
            continue;
          }
          
          if (!response.ok) {
            throw new Error(`Push failed: ${response.status}`);
          }
          
          return await response.json();
        } catch (error) {
          retries++;
          if (retries >= maxRetries) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
        }
      }
    }
  },
  
  pull: {
    async handler(checkpoint, batchSize) {
      // Similar retry logic for pull
    }
  }
});

// Handle connection state changes
replicationState.error$.subscribe(error => {
  console.error('Replication error:', error);
  
  // Implement exponential backoff
  if (error.type === 'network') {
    setTimeout(() => {
      replicationState.reSync();
    }, Math.min(60000, 1000 * Math.pow(2, error.retryCount)));
  }
});
```

#### 2. Performance Optimization
```typescript
// Database indexes for efficient queries
await db.tasks.createIndex(['updatedAt', 'id']);
await db.tasks.createIndex(['userId', 'updatedAt']); // For user-specific queries

// Optimize batch sizes based on document size
const avgDocSize = 1024; // bytes
const targetBatchSize = 100 * 1024; // 100KB per batch
const optimalBatchSize = Math.floor(targetBatchSize / avgDocSize);

const replicationState = await replicateRxCollection({
  collection: db.tasks,
  push: {
    batchSize: Math.min(100, optimalBatchSize),
    handler: async (changeRows) => {
      // Use bulk operations on server
      return await api.bulkPush(changeRows);
    }
  },
  pull: {
    batchSize: Math.min(500, optimalBatchSize * 2),
    handler: async (checkpoint, batchSize) => {
      // Request compression for large payloads
      const response = await fetch(
        `/api/replication/pull?checkpoint=${encodeURIComponent(
          JSON.stringify(checkpoint)
        )}&limit=${batchSize}`,
        {
          headers: {
            'Accept-Encoding': 'gzip, deflate'
          }
        }
      );
      return await response.json();
    }
  }
});

// Implement query result caching
const queryCache = new Map();
const cachedQuery = async (checkpoint) => {
  const key = JSON.stringify(checkpoint);
  if (queryCache.has(key)) {
    return queryCache.get(key);
  }
  const result = await api.pull(checkpoint);
  queryCache.set(key, result);
  // Clear cache after 5 minutes
  setTimeout(() => queryCache.delete(key), 300000);
  return result;
};
```

#### 3. Monitoring & Metrics
```typescript
// Comprehensive monitoring setup
class ReplicationMonitor {
  constructor(replicationState) {
    this.state = replicationState;
    this.metrics = {
      sent: 0,
      received: 0,
      conflicts: 0,
      errors: 0,
      lastSync: null
    };
    
    this.setupMonitoring();
  }
  
  setupMonitoring() {
    // Track documents sent
    this.state.sent$.subscribe(sent => {
      this.metrics.sent += sent;
      this.report('documents.sent', sent);
    });
    
    // Track documents received
    this.state.received$.subscribe(received => {
      this.metrics.received += received;
      this.metrics.lastSync = new Date();
      this.report('documents.received', received);
    });
    
    // Track conflicts
    this.state.conflict$.subscribe(conflicts => {
      this.metrics.conflicts += conflicts.length;
      this.report('conflicts.detected', conflicts.length);
    });
    
    // Track errors
    this.state.error$.subscribe(error => {
      this.metrics.errors++;
      this.report('errors.count', 1, { type: error.type });
    });
    
    // Health checks
    setInterval(() => {
      const now = Date.now();
      const lastSyncAge = this.metrics.lastSync 
        ? now - this.metrics.lastSync.getTime() 
        : Infinity;
      
      this.report('health.last_sync_age_ms', lastSyncAge);
      this.report('health.is_alive', this.state.alive);
      this.report('health.pending_pushes', this.state.pendingPushSequences.size);
    }, 30000);
  }
  
  report(metric, value, tags = {}) {
    // Send to your monitoring service
    console.log(`[METRIC] ${metric}: ${value}`, tags);
    // Example: statsD.gauge(metric, value, tags);
  }
}

const monitor = new ReplicationMonitor(replicationState);
```

#### 4. Security Considerations
```typescript
// Implement row-level security
const secureReplicationState = await replicateRxCollection({
  collection: db.tasks,
  pull: {
    async handler(checkpoint, batchSize) {
      // Include user context in pull requests
      const response = await fetch(
        `/api/replication/pull?checkpoint=${encodeURIComponent(
          JSON.stringify(checkpoint)
        )}&limit=${batchSize}&userId=${getCurrentUserId()}`,
        {
          headers: {
            'Authorization': `Bearer ${getAuthToken()}`,
            'X-Request-ID': generateRequestId() // For tracking
          }
        }
      );
      
      const data = await response.json();
      
      // Validate received documents
      for (const doc of data.documents) {
        if (!validateDocument(doc)) {
          throw new Error('Invalid document received');
        }
      }
      
      return data;
    }
  },
  push: {
    async handler(changeRows) {
      // Sanitize outgoing data
      const sanitized = changeRows.map(row => ({
        ...row,
        newDocumentState: sanitizeDocument(row.newDocumentState)
      }));
      
      return await api.push(sanitized);
    }
  }
});

// Document validation
function validateDocument(doc) {
  // Ensure document has required fields
  if (!doc.id || !doc.updatedAt) return false;
  
  // Validate data types
  if (typeof doc.updatedAt !== 'number') return false;
  
  // Check for injection attempts
  if (JSON.stringify(doc).includes('<script>')) return false;
  
  return true;
}
```

#### 5. Handling Scale
```typescript
// Implement connection pooling for SSE
class SSEConnectionPool {
  constructor(maxConnections = 100) {
    this.connections = new Map();
    this.maxConnections = maxConnections;
  }
  
  addConnection(clientId, response) {
    if (this.connections.size >= this.maxConnections) {
      // Reject new connections when at capacity
      response.status(503).send('Server at capacity');
      return false;
    }
    
    this.connections.set(clientId, response);
    return true;
  }
  
  broadcast(event) {
    // Efficiently broadcast to all connections
    const message = `data: ${JSON.stringify(event)}\n\n`;
    
    for (const [clientId, response] of this.connections) {
      try {
        response.write(message);
      } catch (error) {
        // Remove dead connections
        this.connections.delete(clientId);
      }
    }
  }
}

// Use with pull-stream endpoint
const ssePool = new SSEConnectionPool();

app.get('/api/replication/pull-stream', (req, res) => {
  const clientId = req.headers['x-client-id'] || crypto.randomUUID();
  
  if (!ssePool.addConnection(clientId, res)) {
    return;
  }
  
  // ... rest of SSE setup
});
```

### Migration from Current Solution

To migrate from your current TanStack DB + Convex solution to RxDB:

1. **Install RxDB dependencies:**
```bash
npm install rxdb rxdb-server @tanstack/rxdb-db-collection
```

2. **Create migration script:**
```typescript
// Migrate existing data
const migrateToRxDB = async () => {
  // Create RxDB database
  const rxdb = await createRxDatabase({
    name: 'myapp',
    storage: getRxStorageIndexedDB()
  });
  
  // Add collections
  await rxdb.addCollections({
    tasks: { schema: taskSchema }
  });
  
  // Import existing data
  const existingTasks = await convexClient.query(api.tasks.get);
  await rxdb.tasks.bulkInsert(existingTasks);
  
  // Start replication
  await startReplication(rxdb);
};
```

3. **Update Convex backend to support RxDB protocol:**
```typescript
// convex/replication.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

// Pull endpoint
http.route({
  path: "/replication/pull",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const checkpoint = JSON.parse(
      url.searchParams.get('checkpoint') || '{}'
    );
    const limit = parseInt(
      url.searchParams.get('limit') || '100'
    );
    
    // Query Convex for changes
    const documents = await ctx.runQuery(
      internal.replication.pull,
      { checkpoint, limit }
    );
    
    return new Response(JSON.stringify(documents), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  })
});

// Push endpoint
http.route({
  path: "/replication/push",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const changeRows = await request.json();
    
    // Process changes in Convex
    const conflicts = await ctx.runMutation(
      internal.replication.push,
      { changeRows }
    );
    
    return new Response(JSON.stringify(conflicts), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  })
});

export default http;
```

### Production-Ready Implementation Example

Here's a complete example tying everything together:

```typescript
// server/replication.ts
import express from 'express';
import { Subject } from 'rxjs';
import { MongoClient } from 'mongodb';

const app = express();
const pullStream$ = new Subject();
const ssePool = new SSEConnectionPool();

// Middleware
app.use(express.json());
app.use(compression());
app.use(cors());

// Pull endpoint with optimizations
app.get('/api/replication/pull', async (req, res) => {
  const session = await mongoClient.startSession();
  
  try {
    const { id = '', updatedAt = 0 } = req.query.checkpoint 
      ? JSON.parse(req.query.checkpoint) 
      : {};
    const limit = Math.min(parseInt(req.query.limit || '100'), 1000);
    const userId = req.userId; // From auth middleware
    
    // User-scoped query with efficient indexing
    const documents = await db.collection('tasks')
      .find({
        userId,
        $or: [
          { updatedAt: { $gt: updatedAt } },
          { updatedAt: { $eq: updatedAt }, id: { $gt: id } }
        ]
      }, { session })
      .sort({ updatedAt: 1, id: 1 })
      .limit(limit)
      .toArray();
    
    const checkpoint = documents.length === 0 
      ? { id, updatedAt }
      : {
          id: documents[documents.length - 1].id,
          updatedAt: documents[documents.length - 1].updatedAt
        };
    
    res.json({ documents, checkpoint });
  } finally {
    await session.endSession();
  }
});

// Push endpoint with transaction support
app.post('/api/replication/push', async (req, res) => {
  const session = await mongoClient.startSession();
  const conflicts = [];
  const events = [];
  
  try {
    await session.withTransaction(async () => {
      for (const changeRow of req.body) {
        const { newDocumentState, assumedMasterState } = changeRow;
        
        // Validate ownership
        if (newDocumentState.userId !== req.userId) {
          throw new Error('Unauthorized');
        }
        
        const current = await db.collection('tasks')
          .findOne({ id: newDocumentState.id }, { session });
        
        if (
          current && !assumedMasterState ||
          (current && assumedMasterState && 
           current.updatedAt !== assumedMasterState.updatedAt)
        ) {
          conflicts.push(current);
        } else {
          // Apply change
          const operation = newDocumentState._deleted
            ? db.collection('tasks').deleteOne(
                { id: newDocumentState.id }, 
                { session }
              )
            : db.collection('tasks').replaceOne(
                { id: newDocumentState.id },
                { ...newDocumentState, updatedAt: Date.now() },
                { upsert: true, session }
              );
          
          await operation;
          events.push(newDocumentState);
        }
      }
    });
    
    // Broadcast changes to connected clients
    if (events.length > 0) {
      const streamEvent = {
        documents: events,
        checkpoint: {
          id: events[events.length - 1].id,
          updatedAt: events[events.length - 1].updatedAt
        }
      };
      
      pullStream$.next(streamEvent);
      ssePool.broadcast(streamEvent);
    }
    
    res.json(conflicts);
  } finally {
    await session.endSession();
  }
});

// Pull stream endpoint
app.get('/api/replication/pull-stream', (req, res) => {
  const clientId = req.headers['x-client-id'] || crypto.randomUUID();
  
  if (!ssePool.addConnection(clientId, res)) {
    return;
  }
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 30000);
  
  const subscription = pullStream$
    .pipe(
      // Filter events for this user
      filter(event => event.documents[0]?.userId === req.userId)
    )
    .subscribe(event => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
  
  req.on('close', () => {
    clearInterval(heartbeat);
    subscription.unsubscribe();
    ssePool.removeConnection(clientId);
  });
});

// Client implementation
// client/database.ts
import { createRxDatabase } from 'rxdb';
import { getRxStorageIndexedDB } from 'rxdb/plugins/storage-indexeddb';
import { replicateRxCollection } from 'rxdb/plugins/replication';
import { Subject } from 'rxjs';

export async function setupDatabase() {
  const db = await createRxDatabase({
    name: 'myapp',
    storage: getRxStorageIndexedDB(),
    multiInstance: true,
    eventReduce: true
  });
  
  await db.addCollections({
    tasks: {
      schema: taskSchema,
      conflictHandler: fieldMergeHandler
    }
  });
  
  // Create indexes
  await db.tasks.createIndex(['updatedAt', 'id']);
  await db.tasks.createIndex(['userId', 'updatedAt']);
  
  // Setup replication with all production features
  const pullStream$ = new Subject();
  let eventSource = null;
  
  const replicationState = await replicateRxCollection({
    collection: db.tasks,
    replicationIdentifier: 'tasks-sync',
    live: true,
    retry: true,
    retryTime: 5000,
    
    push: {
      batchSize: 50,
      async handler(changeRows) {
        const response = await fetch('/api/replication/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}`,
            'X-Client-ID': getClientId()
          },
          body: JSON.stringify(changeRows)
        });
        
        if (!response.ok) {
          throw new Error(`Push failed: ${response.status}`);
        }
        
        return await response.json();
      }
    },
    
    pull: {
      batchSize: 200,
      async handler(checkpoint, batchSize) {
        const response = await fetch(
          `/api/replication/pull?checkpoint=${
            encodeURIComponent(JSON.stringify(checkpoint))
          }&limit=${batchSize}`,
          {
            headers: {
              'Authorization': `Bearer ${getAuthToken()}`,
              'Accept-Encoding': 'gzip'
            }
          }
        );
        
        if (!response.ok) {
          throw new Error(`Pull failed: ${response.status}`);
        }
        
        return await response.json();
      },
      stream$: pullStream$.asObservable()
    }
  });
  
  // Setup SSE connection
  function connectSSE() {
    eventSource = new EventSource('/api/replication/pull-stream', {
      withCredentials: true
    });
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      pullStream$.next(data);
    };
    
    eventSource.onerror = () => {
      eventSource.close();
      // Reconnect after delay
      setTimeout(connectSSE, 5000);
      // Trigger resync
      pullStream$.next('RESYNC');
    };
  }
  
  connectSSE();
  
  // Monitor replication
  const monitor = new ReplicationMonitor(replicationState);
  
  return { db, replicationState, monitor };
}
```

### Summary

RxDB provides the most robust solution for offline-first applications:

✅ **Battle-tested** in production environments  
✅ **Multiple storage backends** (IndexedDB, SQLite, etc.)  
✅ **Built-in conflict resolution**  
✅ **Real-time sync** with live queries  
✅ **Cross-tab synchronization**  
✅ **Works with any backend**  
✅ **Compression & encryption**  
✅ **Schema migrations**  
✅ **TypeScript support**  

While it requires more initial setup than the simpler options, RxDB provides a production-ready foundation that handles edge cases, scales well, and maintains data integrity in complex offline scenarios.

The key to successful RxDB implementation is:
1. **Proper server endpoints** - Pull, Push, and optionally Pull-Stream
2. **Robust conflict resolution** - Choose the right strategy for your use case
3. **Error handling** - Implement retries and exponential backoff
4. **Performance optimization** - Use indexes, batching, and caching
5. **Monitoring** - Track sync health and performance metrics
6. **Security** - Implement authentication, authorization, and validation