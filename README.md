# Convex Replicate

**Offline-first sync library using Yjs CRDTs and Convex for real-time data synchronization.**

Convex Replicate provides a dual-storage architecture for building offline-capable applications with automatic conflict resolution. It combines Yjs CRDTs (96% smaller than Automerge, no WASM) with TanStack's offline transaction system and Convex's reactive backend for real-time synchronization and efficient querying.

## Features

- **Offline-first** - Works without internet, syncs when reconnected
- **Yjs CRDTs** - Automatic conflict-free replication with Yjs (96% smaller than Automerge, no WASM)
- **TanStack offline-transactions** - Proven outbox pattern for reliable offline sync
- **Real-time sync** - Convex WebSocket-based synchronization
- **TanStack DB integration** - Reactive state management for React and Svelte
- **Dual-storage pattern** - CRDT layer for conflict resolution + main tables for queries
- **Type-safe** - Full TypeScript support
- **Multi-tab sync** - Changes sync instantly across browser tabs via TanStack coordination
- **SSR support** - Server-side rendering with data preloading
- **Network resilience** - Automatic retry with exponential backoff
- **Component-based** - Convex component for plug-and-play CRDT storage
- **React Native compatible** - No WASM dependency, works on mobile

## Architecture

### High-Level Overview

```mermaid
graph TB
    App[React/Svelte Application<br/>TanStack Start/Router/SvelteKit]
    Hook[Custom Hook<br/>useTasks, etc.]
    TanStack[TanStack DB<br/>Reactive Collections]
    Yjs[Yjs CRDT<br/>Conflict-Free Merging]
    Offline[TanStack Offline Executor<br/>Outbox Pattern & Retry]
    Component[Convex Component<br/>@trestleinc/convex-replicate-component]
    MainTable[Main App Tables<br/>tasks, etc.]

    App --> Hook
    Hook --> TanStack
    TanStack --> Yjs
    Yjs --> Offline
    Offline <-->|WebSocket| Component
    Component --> MainTable
```

### Data Flow: Real-Time Sync

```mermaid
sequenceDiagram
    participant User
    participant UI as React/Svelte Component
    participant TDB as TanStack DB
    participant Yjs as Yjs CRDT
    participant Offline as Offline Executor
    participant Convex as Convex Component
    participant Table as Main Table

    User->>UI: Create/Update Task
    UI->>TDB: collection.insert/update
    TDB->>Yjs: Update Yjs CRDT
    Yjs-->>TDB: Notify change
    TDB-->>UI: Re-render (optimistic)

    Note over Offline: Automatic retry with backoff
    Offline->>Yjs: Get CRDT bytes
    Offline->>Convex: insertDocument/updateDocument mutation
    Convex->>Table: Insert/Update materialized doc

    Note over Convex,Table: Change detected
    Convex-->>Offline: changeStream notification
    Offline->>Convex: Refetch tasks
    Convex->>Table: Query updated docs
    Convex-->>Offline: Return changes
    Offline->>TDB: Update collection
    TDB-->>UI: Re-render with synced data
```

### Dual-Storage Architecture

```mermaid
graph LR
    Client[Client<br/>Yjs CRDT]
    Component[Component Storage<br/>CRDT Layer<br/>Conflict Resolution]
    MainTable[Main Application Table<br/>Materialized Docs<br/>Efficient Queries]

    Client -->|insertDocument/updateDocument| Component
    Component -->|also writes to| MainTable
    MainTable -->|changeStream subscription| Client
```

**Why both?**
- **Component Storage**: Handles conflict resolution with Yjs CRDTs, source of truth for offline changes
- **Main Tables**: Enables efficient server-side queries, joins, and reactive subscriptions
- Similar to event sourcing: component = event log, main table = read model

## Packages

### `@trestleinc/convex-replicate-core`

**Framework-agnostic utilities** - Replication helpers and SSR utilities for Convex Replicate.

**What it provides:**
- `convexCollectionOptions` - TanStack DB collection options for Yjs CRDT integration
- `createConvexCollection` - Wraps collections with Yjs + TanStack offline-transactions support
- `loadCollection()` - SSR data preloading for instant page loads
- Server-side replication helpers (`insertDocumentHelper`, `updateDocumentHelper`, etc.)
- Logging utilities via LogTape

**Use when:**
- Building React or Svelte applications with TanStack DB
- Need SSR/SSG support (Next.js, Remix, TanStack Start, SvelteKit)
- Building custom framework integrations

### `@trestleinc/convex-replicate-component`

**Convex component for CRDT storage** - Plug-and-play Convex component providing the backend storage layer.

**What it provides:**
- `ReplicateStorage` - Type-safe API for interacting with the component
- Internal CRDT storage table with indexes
- `insertDocument()` - Insert new documents with CRDT bytes
- `updateDocument()` - Update existing documents with CRDT bytes (also used for soft deletes)
- `pullChanges()` - Incremental sync with checkpoints
- `changeStream()` - Real-time change detection

**Use when:**
- Setting up the backend Convex storage layer
- Need CRDT-based conflict resolution
- Want plug-and-play replication infrastructure

## Installation

```bash
# Using bun (automatically installs peer dependencies)
bun add @trestleinc/convex-replicate-core @trestleinc/convex-replicate-component convex @tanstack/react-db

# Using npm (peer dependencies must be installed explicitly)
npm install @trestleinc/convex-replicate-core @trestleinc/convex-replicate-component convex @tanstack/react-db
npm install yjs @tanstack/offline-transactions

# Using yarn
yarn add @trestleinc/convex-replicate-core @trestleinc/convex-replicate-component convex @tanstack/react-db
yarn add yjs @tanstack/offline-transactions

# Using pnpm
pnpm add @trestleinc/convex-replicate-core @trestleinc/convex-replicate-component convex @tanstack/react-db
pnpm add yjs @tanstack/offline-transactions
```

**Note:** Starting from v0.3.0, Yjs and TanStack offline-transactions are peer dependencies. Bun automatically installs peer dependencies, but npm/yarn/pnpm require explicit installation. This approach gives you control over CRDT library versions and reduces bundle size by 96% compared to Automerge. See [MIGRATION-0.3.0.md](./MIGRATION-0.3.0.md) for migration from v0.2.x.

## Quick Start

### Step 1: Install the Convex Component

Add the replicate component to your Convex app configuration:

```typescript
// convex/convex.config.ts
import { defineApp } from 'convex/server';
import replicate from '@trestleinc/convex-replicate-component/convex.config';

const app = defineApp();
app.use(replicate);

export default app;
```

### Step 2: Define Your Schema

Create your main application table with required fields:

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  tasks: defineTable({
    // Required fields for Convex Replicate:
    id: v.string(),              // Client-generated UUID (document identifier)
    version: v.number(),         // CRDT version (for conflict detection)
    timestamp: v.number(),       // Last modification time (for incremental sync)
    
    // Your application fields:
    text: v.string(),
    isCompleted: v.boolean(),
  })
    .index('by_user_id', ['id'])      // Required for document lookups/updates
    .index('by_timestamp', ['timestamp']), // Required for incremental sync
});
```

**Required fields:**
- `id` - Client-generated UUID (document identifier)
- `version` - CRDT version number (for optimistic concurrency control)
- `timestamp` - Last modification timestamp (enables incremental sync)

**Required indexes:**
- `by_user_id` on `['id']` - Enables fast document lookups during updates
- `by_timestamp` on `['timestamp']` - Enables efficient incremental synchronization

### Step 3: Create Replication Functions

Create functions that use replication helpers for dual-storage pattern:

```typescript
// convex/tasks.ts
import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { v } from 'convex/values';
import {
  insertDocumentHelper,
  updateDocumentHelper,
  pullChangesHelper,
  changeStreamHelper,
} from '@trestleinc/convex-replicate-core/replication'; // IMPORTANT: Use /replication for server-safe imports!

/**
 * TanStack DB endpoints - called by createConvexCollection
 * These receive Yjs CRDT bytes from client and write to both:
 * 1. Component storage (Yjs CRDT bytes for conflict resolution)
 * 2. Main table (materialized docs for efficient queries)
 */

export const insertDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    materializedDoc: v.any(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
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

/**
 * Stream endpoint for real-time subscriptions
 * Returns ALL items including soft-deleted ones for proper Yjs CRDT synchronization
 * UI layer filters out deleted items for display
 */
export const stream = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect();
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

### Step 4: Create a Custom Hook

Create a hook that wraps TanStack DB with Yjs collection options:

```typescript
// src/useTasks.ts
import { createCollection } from '@tanstack/react-db';
import {
  convexCollectionOptions,
  createConvexCollection,
  type ConvexCollection,
} from '@trestleinc/convex-replicate-core';
import { api } from '../convex/_generated/api';
import { convexClient } from './router';
import { useMemo } from 'react';

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

// Module-level singleton to prevent multiple collection instances
// This ensures only one sync process runs, even across component remounts
let tasksCollection: ConvexCollection<Task>;

export function useTasks(initialData?: ReadonlyArray<Task>) {
  return useMemo(() => {
    if (!tasksCollection) {
      // Step 1: Create raw TanStack DB collection with ALL config
      const rawCollection = createCollection(
        convexCollectionOptions<Task>({
          convexClient,
          api: api.tasks,  // Points to tasks.ts functions
          collectionName: 'tasks',
          getKey: (task) => task.id,
          initialData,
        })
      );

      // Step 2: Wrap with Convex offline support (Yjs + TanStack)
      // Config is automatically extracted from rawCollection
      tasksCollection = createConvexCollection(rawCollection);
    }
    return tasksCollection;
  }, [initialData]);
}
```

### Step 5: Use in Components

```typescript
// src/routes/index.tsx
import { useLiveQuery } from '@tanstack/react-db';
import { useTasks } from '../useTasks';

export function TaskList() {
  const collection = useTasks();
  const { data: allTasks, isLoading, isError } = useLiveQuery(collection);

  // Filter out soft-deleted items (deleted is just a boolean field like isCompleted)
  const tasks = allTasks?.filter((task: Task) => !(task as any).deleted) || [];

  const handleCreate = () => {
    collection.insert({
      id: crypto.randomUUID(),
      text: 'New task',
      isCompleted: false,
    });
  };

  const handleUpdate = (id: string, isCompleted: boolean) => {
    collection.update(id, (draft: Task) => {
      draft.isCompleted = !isCompleted;
    });
  };

  const handleDelete = (id: string) => {
    // Soft delete - just set a field, like isCompleted!
    collection.update(id, (draft: Task) => {
      (draft as any).deleted = true;
      (draft as any).deletedAt = Date.now();
    });
  };

  if (isError) {
    return <div>Error loading tasks. Please refresh.</div>;
  }

  if (isLoading) {
    return <div>Loading tasks...</div>;
  }

  return (
    <div>
      <button onClick={handleCreate}>Add Task</button>

      {tasks.map((task) => (
        <div key={task.id}>
          <input
            type="checkbox"
            checked={task.isCompleted}
            onChange={() => handleUpdate(task.id, task.isCompleted)}
          />
          <span>{task.text}</span>
          <button onClick={() => handleDelete(task.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
```

### Delete Pattern: Soft Delete

**Treat `deleted` like `isCompleted` - just a boolean field!**

Convex Replicate uses **soft deletes** where items are marked with a `deleted: true` field rather than being removed from the collection. This approach:

- ✅ Works exactly like updating `isCompleted` (simple field update)
- ✅ Maintains CRDT consistency across clients
- ✅ No special `onDelete` handler or complex logic needed
- ✅ UI filters out deleted items for display

**Implementation:**

```typescript
// Delete handler (uses collection.update, not collection.delete)
const handleDelete = (id: string) => {
  collection.update(id, (draft: Task) => {
    draft.deleted = true;
    draft.deletedAt = Date.now();
  });
};

// Filter deleted items in UI
const { data: allTasks } = useLiveQuery(collection);
const tasks = allTasks?.filter((task: Task) => !task.deleted) || [];

// SSR loader should also filter
export const Route = createFileRoute('/')({
  loader: async () => {
    const allTasks = await httpClient.query(api.tasks.stream);
    const tasks = allTasks.filter((task: any) => !task.deleted);
    return { tasks };
  },
});
```

**Why soft delete?**
- Hard deletes (`collection.delete()`) physically remove items, breaking CRDT sync
- Soft deletes keep items in Yjs for proper conflict resolution
- Server returns all items (including deleted) for CRDT completeness
- UI simply filters out `deleted: true` items

**Server-side:** Return ALL items including deleted ones. The subscription needs complete CRDT state for proper synchronization:

```typescript
// convex/tasks.ts
export const stream = query({
  handler: async (ctx) => {
    // Return ALL items (Yjs CRDT needs complete state)
    return await ctx.db.query('tasks').collect();
  },
});
```

## Advanced Usage

### Server-Side Rendering (SSR)

Preload data on the server for instant page loads. You'll need to create a separate query that reads from your main table:

**Step 1: Create an SSR-friendly query**

```typescript
// convex/tasks.ts
export const getTasks = query({
  handler: async (ctx) => {
    return await ctx.db
      .query('tasks')
      .collect();
  },
});
```

**Step 2: Load data in your route loader**

```typescript
// src/routes/index.tsx
import { createFileRoute } from '@tanstack/react-router';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
import type { Task } from '../useTasks';

const httpClient = new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL);

export const Route = createFileRoute('/')({
  loader: async () => {
    const tasks = await httpClient.query(api.tasks.getTasks);
    return { tasks };
  },
});

function TasksPage() {
  const { tasks: initialTasks } = Route.useLoaderData();

  // Pass initialData to your hook
  const collection = useTasks(initialTasks);
  const { data: tasks } = useLiveQuery(collection);

  // No loading state on first render!
  return <TaskList tasks={tasks} />;
}
```

> **Note:** The `loadCollection` utility from `@trestleinc/convex-replicate-core/ssr` is available but requires you to decode CRDT bytes. For most use cases, a simple query like `getTasks` above is easier and more efficient.

### Direct Component Usage (Advanced)

> **⚠️ WARNING:** Using `ReplicateStorage` directly only writes to the component CRDT storage layer. It does NOT implement the dual-storage pattern (no writes to main table), which means:
> - You cannot query this data efficiently in Convex
> - You lose the benefits of reactive subscriptions on materialized docs
> - You'll need to manually handle materialization
> 
> **Recommended:** Use the replication helpers (`insertDocumentHelper`, etc.) shown in Step 3 for the full dual-storage pattern.

For advanced use cases where you need direct component access, you can use `ReplicateStorage`:

```typescript
// convex/tasks.ts
import { ReplicateStorage } from '@trestleinc/convex-replicate-component';
import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { v } from 'convex/values';

interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

const tasksStorage = new ReplicateStorage<Task>(components.replicate, 'tasks');

export const insertTask = mutation({
  args: {
    id: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    return await tasksStorage.insertDocument(
      ctx,
      args.id,
      args.crdtBytes,
      args.version
    );
  },
});

export const updateTask = mutation({
  args: {
    id: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    return await tasksStorage.updateDocument(
      ctx,
      args.id,
      args.crdtBytes,
      args.version
    );
  },
});

export const getTasks = query({
  args: {
    checkpoint: v.object({ lastModified: v.number() }),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await tasksStorage.pullChanges(ctx, args.checkpoint, args.limit);
  },
});

export const watchTasks = query({
  handler: async (ctx) => {
    return await tasksStorage.changeStream(ctx);
  },
});
```

### Logging Configuration

Configure logging for debugging and development using LogTape:

```typescript
// src/routes/__root.tsx or app entry point
import { configure, getConsoleSink } from '@logtape/logtape';

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    {
      category: ['convex-replicate'],
      lowestLevel: 'debug',  // 'debug' | 'info' | 'warn' | 'error'
      sinks: ['console']
    }
  ],
});
```

Get a logger instance for custom logging:

```typescript
import { getLogger } from '@trestleinc/convex-replicate-core';

const logger = getLogger(['my-module']); // Accepts string or string array

logger.info('Operation started', { userId: '123' });
logger.warn('Something unexpected', { reason: 'timeout' });
logger.error('Operation failed', { error });
```

## API Reference

### `@trestleinc/convex-replicate-core`

#### `convexCollectionOptions<T>(config)`

Creates collection options for TanStack DB with Yjs CRDT integration.

**Config:**
```typescript
interface ConvexCollectionOptionsConfig<T> {
  convexClient: ConvexClient;
  api: {
    insertDocument: FunctionReference;
    updateDocument: FunctionReference;
    stream: FunctionReference;  // Real-time subscription endpoint
  };
  collectionName: string;
  getKey: (item: T) => string;
  initialData?: ReadonlyArray<T>;
}
```

**Returns:** Collection options for `createCollection()`

**Example:**
```typescript
// Step 1: Create raw collection
const rawCollection = createCollection(
  convexCollectionOptions<Task>({
    convexClient,
    api: api.tasks,
    collectionName: 'tasks',
    getKey: (task) => task.id,
    initialData,
  })
);

// Step 2: Wrap with offline support
const collection = createConvexCollection(rawCollection);
```

#### `loadCollection<T>(httpClient, config)`

Loads collection data during SSR for instant page loads.

**Parameters:**
- `httpClient` - ConvexHttpClient instance for server-side queries
- `config` - Configuration object:
  - `api` - The API module for replication functions
  - `collection` - Collection name
  - `limit?` - Maximum items to load (default: 100)

**Returns:** `Promise<ReadonlyArray<T>>`

**Example:**
```typescript
const tasks = await loadCollection<Task>(httpClient, {
  api: api.tasks,
  collection: 'tasks',
  limit: 50,
});
```

#### `getLogger(category)`

Get a logger instance for custom logging.

**Parameters:**
- `category: string | string[]` - Logger category (string or array of strings)

**Returns:** Logger with `debug()`, `info()`, `warn()`, `error()` methods

**Examples:**
```typescript
// Single string
const logger = getLogger('my-module');

// String array for hierarchical categories
const logger = getLogger(['hooks', 'useTasks']);

logger.debug('Task created', { id: taskId });
logger.info('Operation completed', { count: 5 });
```

### `@trestleinc/convex-replicate-component`

#### `ReplicateStorage<TDocument>`

Type-safe API for interacting with the replicate component.

**Constructor:**
```typescript
new ReplicateStorage<TDocument>(component, collectionName)
```

**Methods:**

##### `insertDocument(ctx, documentId, crdtBytes, version)`
Insert a new document with Yjs CRDT bytes.

**Parameters:**
- `ctx` - Convex mutation context
- `documentId` - Unique document identifier
- `crdtBytes` - ArrayBuffer containing Yjs CRDT bytes (Y.encodeStateAsUpdate)
- `version` - CRDT version number

**Returns:** `Promise<{ success: boolean }>`

##### `updateDocument(ctx, documentId, crdtBytes, version)`
Update an existing document with Yjs CRDT bytes.

**Parameters:**
- `ctx` - Convex mutation context
- `documentId` - Unique document identifier
- `crdtBytes` - ArrayBuffer containing Yjs CRDT bytes (Y.encodeStateAsUpdate)
- `version` - CRDT version number

**Returns:** `Promise<{ success: boolean }>`

**Note on deletes:** For soft deletes, use `updateDocument()` with a `deleted: true` field. Treat deletion as a field update, just like `isCompleted`.

##### `pullChanges(ctx, checkpoint, limit?)`
Pull document changes for incremental sync.

**Parameters:**
- `ctx` - Convex query context
- `checkpoint` - Object with `{ lastModified: number }`
- `limit` - Optional max changes (default: 100)

**Returns:**
```typescript
Promise<{
  changes: Array<{
    documentId: string;
    crdtBytes: ArrayBuffer;  // Yjs CRDT bytes
    version: number;
    timestamp: number;
  }>;
  checkpoint: { lastModified: number };
  hasMore: boolean;
}>
```

##### `changeStream(ctx)`
Subscribe to collection changes.

**Parameters:**
- `ctx` - Convex query context

**Returns:** `Promise<{ timestamp: number; count: number }>`

## Performance

### Storage Performance

- **IndexedDB** via TanStack DB provides efficient local storage
- **Yjs** CRDT operations are extremely fast (96% smaller than Automerge)
- **TanStack offline-transactions** provides batching and retry logic
- **Indexed queries** in Convex for fast incremental sync

### Sync Performance

- **Change streams** - WebSocket-based real-time updates
- **Incremental sync** - Only pull changed documents since last checkpoint
- **Optimistic UI** - Instant updates without waiting for server

### Multi-Tab Sync

- **TanStack coordination** - Built-in multi-tab sync via BroadcastChannel
- **Yjs shared state** - Single source of truth per browser
- **Offline executor** - Only one tab runs sync operations

## Offline Behavior

### How It Works

- **Writes** - Queue locally in Yjs CRDT, sync when online via TanStack outbox
- **Reads** - Always work from local TanStack DB cache (instant!)
- **UI** - Fully functional with optimistic updates
- **Conflicts** - Auto-resolved by Yjs CRDTs (conflict-free!)

### Network Resilience

- Automatic retry with exponential backoff
- Network error detection (fetch errors, connection issues)
- Queue changes while offline
- Graceful degradation

## Examples

Complete working example: `examples/tanstack-start/`

**Files to explore:**
- `src/useTasks.ts` - Hook with TanStack DB integration
- `src/routes/index.tsx` - Component usage with SSR
- `src/routes/__root.tsx` - Logging configuration
- `convex/tasks.ts` - Replication functions using dual-storage helpers
- `convex/schema.ts` - Schema with required indexes

## Development

### Building Packages

```bash
bun run build         # Build all packages (component → core)
bun run build:component # Build component only
bun run build:core    # Build core only
bun run clean         # Remove build artifacts
```

### Type Checking

```bash
bun run typecheck     # Check all packages
```

### Code Quality

```bash
bun run check         # Lint + format check (dry run)
bun run check:fix     # Auto-fix all issues (run before committing)
bun run lint          # Lint only
bun run lint:fix      # Auto-fix lint issues
bun run format        # Format only
bun run format:check  # Check formatting
```

### Running Example

```bash
bun run dev:example   # Start example app + Convex dev environment
```

## Roadmap

- [ ] Partial sync (sync subset of collection)
- [ ] Delta sync (only sync changed fields)
- [ ] Encryption at rest
- [ ] Attachment support (files, images)
- [ ] Vue wrapper (Svelte already supported!)
- [x] React Native support (works with Yjs v0.3.0+)
- [ ] Advanced Yjs features (rich text editing, shared cursors)

## Contributing

Contributions welcome! Please see `CLAUDE.md` for coding standards.

## License

Apache-2.0 License - see [LICENSE](./LICENSE) file for details.

Copyright 2025 Trestle Inc
