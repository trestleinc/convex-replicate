# @trestleinc/convex-replicate-core

**Framework-agnostic replication utilities for offline-first applications with Automerge CRDTs and Convex.**

Part of [Convex Replicate](https://github.com/trestleinc/convex-replicate) - a dual-storage architecture for building offline-capable applications with automatic conflict resolution.

## What's Included

This package provides client-side utilities for building offline-first applications:

- **`convexCollectionOptions`** - TanStack DB collection configuration with Automerge CRDT integration
- **`ConvexCollection<T>`** - Type helper for collection types
- **`loadCollection()`** - SSR data preloading for instant page loads
- **Server-side helpers** (`/replication` export):
  - `insertDocumentHelper()` - Insert to both CRDT storage + main table
  - `updateDocumentHelper()` - Update both CRDT storage + main table
  - `deleteDocumentHelper()` - Delete from both CRDT storage + main table
  - `pullChangesHelper()` - Read CRDT bytes for incremental sync
  - `changeStreamHelper()` - Detect changes for reactive queries
- **Internal utilities**:
  - `AutomergeDocumentStore` - Local CRDT document storage
  - `SyncAdapter` - Push/pull synchronization adapter
  - `getLogger()` - Structured logging via LogTape

## Installation

```bash
# Install with component package
bun add @trestleinc/convex-replicate-core @trestleinc/convex-replicate-component convex @tanstack/react-db

# Or with npm
npm install @trestleinc/convex-replicate-core @trestleinc/convex-replicate-component convex @tanstack/react-db
```

## Usage

### Client-Side: TanStack DB Integration

Create a collection with Automerge CRDT synchronization:

```typescript
// src/useTasks.ts
import { createCollection } from '@tanstack/react-db';
import { convexCollectionOptions, type ConvexCollection } from '@trestleinc/convex-replicate-core';
import { api } from '../convex/_generated/api';
import { convexClient } from './router';

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

let tasksCollection: ConvexCollection<Task>;

export function useTasks(initialData?: ReadonlyArray<Task>) {
  if (!tasksCollection) {
    tasksCollection = createCollection(
      convexCollectionOptions<Task>({
        convexClient,
        api: api.tasks,          // Convex functions from tasks.ts
        collectionName: 'tasks',
        getKey: (task) => task.id,
        initialData,
      })
    );
  }
  return tasksCollection;
}
```

Use in React components:

```typescript
// src/routes/tasks.tsx
import { useLiveQuery } from '@tanstack/react-db';
import { useTasks } from '../useTasks';

export function TaskList() {
  const collection = useTasks();
  const { data: tasks, isLoading } = useLiveQuery(collection);

  const handleCreate = () => {
    collection.insert({
      id: crypto.randomUUID(),
      text: 'New task',
      isCompleted: false,
    });
  };

  const handleUpdate = (id: string) => {
    collection.update(id, (draft) => {
      draft.isCompleted = !draft.isCompleted;
    });
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <button onClick={handleCreate}>Add Task</button>
      {tasks.map(task => (
        <div key={task.id}>
          <input
            type="checkbox"
            checked={task.isCompleted}
            onChange={() => handleUpdate(task.id)}
          />
          <span>{task.text}</span>
        </div>
      ))}
    </div>
  );
}
```

### Server-Side: Replication Helpers

**IMPORTANT:** Import from `@trestleinc/convex-replicate-core/replication` to avoid bundling Automerge WASM on the server!

```typescript
// convex/tasks.ts
import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { v } from 'convex/values';
import {
  insertDocumentHelper,
  updateDocumentHelper,
  deleteDocumentHelper,
  pullChangesHelper,
  changeStreamHelper,
} from '@trestleinc/convex-replicate-core/replication';  // Use /replication!

export const insertDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    materializedDoc: v.any(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    // Writes to both component (CRDT) and main table (materialized)
    return await insertDocumentHelper(ctx, components, 'tasks', {
      id: args.documentId,
      crdtBytes: args.crdtBytes,
      materializedDoc: args.materializedDoc,
      version: args.version,
    });
  },
});

export const updateDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    materializedDoc: v.any(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    return await updateDocumentHelper(ctx, components, 'tasks', {
      id: args.documentId,
      crdtBytes: args.crdtBytes,
      materializedDoc: args.materializedDoc,
      version: args.version,
    });
  },
});

export const deleteDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await deleteDocumentHelper(ctx, components, 'tasks', {
      id: args.documentId,
    });
  },
});

export const pullChanges = query({
  args: {
    collectionName: v.string(),
    checkpoint: v.object({ lastModified: v.number() }),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await pullChangesHelper(ctx, components, 'tasks', {
      checkpoint: args.checkpoint,
      limit: args.limit,
    });
  },
});

export const changeStream = query({
  args: { collectionName: v.string() },
  handler: async (ctx) => {
    return await changeStreamHelper(ctx, components, 'tasks');
  },
});
```

### SSR: Data Preloading

Load data on the server for instant page loads:

```typescript
// TanStack Start route
import { createFileRoute } from '@tanstack/react-router';
import { loadCollection } from '@trestleinc/convex-replicate-core/ssr';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
import type { Task } from '../useTasks';

export const Route = createFileRoute('/tasks')({
  loader: async () => {
    const httpClient = new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL);

    const tasks = await loadCollection<Task>(httpClient, {
      api: api.tasks,
      collection: 'tasks',
      limit: 100,
    });

    return { tasks };
  },
});

function TasksPage() {
  const { tasks: initialTasks } = Route.useLoaderData();
  const collection = useTasks(initialTasks);
  const { data: tasks } = useLiveQuery(collection);

  // No loading state on first render!
  return <TaskList tasks={tasks} />;
}
```

### Logging

Configure structured logging with LogTape:

```typescript
// src/routes/__root.tsx
import { configure, getConsoleSink } from '@logtape/logtape';

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    {
      category: ['convex-replicate'],
      lowestLevel: 'debug',
      sinks: ['console']
    }
  ],
});
```

Get logger instances:

```typescript
import { getLogger } from '@trestleinc/convex-replicate-core';

const logger = getLogger(['my-module']);

logger.info('Operation started', { userId: '123' });
logger.warn('Something unexpected', { reason: 'timeout' });
logger.error('Operation failed', { error });
```

## API Reference

### `convexCollectionOptions<T>(config)`

Creates TanStack DB collection options with Automerge CRDT integration.

**Config:**
```typescript
interface ConvexCollectionConfig<T> {
  convexClient: ConvexClient;
  api: {
    insertDocument: FunctionReference;
    updateDocument: FunctionReference;
    deleteDocument: FunctionReference;
    pullChanges: FunctionReference;
    changeStream: FunctionReference;
  };
  collectionName: string;
  getKey: (item: T) => string;
  initialData?: ReadonlyArray<T>;
}
```

**Returns:** `CollectionConfig<T>` for use with `createCollection()`

### `ConvexCollection<T>`

Type helper for collection types (hides complex TanStack DB generics).

**Usage:**
```typescript
let tasksCollection: ConvexCollection<Task>;
```

### `loadCollection<T>(httpClient, config)` (from `/ssr`)

Loads collection data during SSR.

**Parameters:**
- `httpClient: ConvexHttpClient` - HTTP client for server-side queries
- `config.api` - API module with replication functions
- `config.collection: string` - Collection name
- `config.limit?: number` - Max items to load (default: 100)

**Returns:** `Promise<ReadonlyArray<T>>`

### Server-Side Helpers (from `/replication`)

#### `insertDocumentHelper(ctx, components, tableName, args)`

Insert document to both CRDT storage and main table.

**Parameters:**
- `ctx` - Convex mutation context
- `components` - Generated components object
- `tableName: string` - Main table name
- `args` - `{ id, crdtBytes, materializedDoc, version }`

#### `updateDocumentHelper(ctx, components, tableName, args)`

Update document in both CRDT storage and main table.

#### `deleteDocumentHelper(ctx, components, tableName, args)`

Delete document from both CRDT storage and main table.

#### `pullChangesHelper(ctx, components, tableName, args)`

Pull CRDT bytes for incremental sync.

**Parameters:**
- `args` - `{ checkpoint: { lastModified: number }, limit?: number }`

#### `changeStreamHelper(ctx, components, tableName)`

Get latest timestamp/count for change detection.

### `getLogger(category)`

Get a LogTape logger instance.

**Parameters:**
- `category: string | string[]` - Logger category

**Returns:** Logger with `debug()`, `info()`, `warn()`, `error()` methods

## Exports

### Main Export (`.`)

**Client-side only** - includes Automerge:
```typescript
import {
  convexCollectionOptions,
  ConvexCollection,
  AutomergeDocumentStore,
  SyncAdapter,
  getLogger,
  configureLogger,
} from '@trestleinc/convex-replicate-core';
```

### Replication Helpers (`./replication`)

**Server-safe** - no Automerge bundling:
```typescript
import {
  insertDocumentHelper,
  updateDocumentHelper,
  deleteDocumentHelper,
  pullChangesHelper,
  changeStreamHelper,
} from '@trestleinc/convex-replicate-core/replication';
```

### SSR Utilities (`./ssr`)

```typescript
import { loadCollection } from '@trestleinc/convex-replicate-core/ssr';
```

## Requirements

- **Convex Schema:** Your main tables must include:
  - `id: v.string()` - Document ID
  - `version: v.number()` - CRDT version
  - `timestamp: v.number()` - Last modification time
  - `deleted?: v.boolean()` - Soft delete flag

- **Indexes:**
  - `by_user_id` on `['id']`
  - `by_timestamp` on `['timestamp']`

Example:
```typescript
// convex/schema.ts
export default defineSchema({
  tasks: defineTable({
    id: v.string(),
    version: v.number(),
    timestamp: v.number(),
    deleted: v.optional(v.boolean()),
    // ... your fields
  })
    .index('by_user_id', ['id'])
    .index('by_timestamp', ['timestamp']),
});
```

## How It Works

### Dual-Storage Pattern

1. **Client** generates Automerge CRDT document
2. **Client** calls `collection.insert()` → TanStack DB
3. **TanStack DB** saves locally + calls `insertDocument` mutation
4. **Convex** writes to:
   - **Component storage** (CRDT bytes for conflict resolution)
   - **Main table** (materialized doc for queries)
5. **Sync** happens automatically every 5 seconds
6. **Remote changes** pulled and merged locally via Automerge

### Offline Support

- All operations work offline (writes queue locally)
- Automerge CRDTs handle conflict-free merging
- Automatic retry with exponential backoff
- BroadcastChannel for cross-tab sync

## Related Packages

- **[@trestleinc/convex-replicate-component](https://www.npmjs.com/package/@trestleinc/convex-replicate-component)** - Convex component for CRDT storage backend

## Documentation

- [Full Documentation](https://github.com/trestleinc/convex-replicate#readme)
- [Migration Guide v0.2.0](https://github.com/trestleinc/convex-replicate/blob/main/MIGRATION-0.2.0.md)
- [Example App](https://github.com/trestleinc/convex-replicate/tree/main/examples/tanstack-start)

## License

Apache-2.0 - see [LICENSE](https://github.com/trestleinc/convex-replicate/blob/main/LICENSE)

Copyright 2025 Trestle Inc
