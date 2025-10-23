# ConvexRx

**Offline-first sync library bridging RxDB (local) and Convex (cloud) for real-time data synchronization.**

ConvexRx provides a framework-agnostic core for building offline-capable applications with real-time sync, plus React-specific defaults for effortless integration with modern React applications.

## Features

- **Offline-first** - Works without internet, syncs when reconnected
- **Real-time bidirectional sync** - Convex WebSocket-based synchronization
- **Framework-agnostic core** - Use with any JavaScript framework
- **React integration** - Pre-built hooks with TanStack DB for reactive state
- **Type-safe** - Full TypeScript support with zero `any` types
- **Auto-generated Convex functions** - No manual replication code needed
- **Flexible conflict resolution** - Server-wins, client-wins, last-write-wins, or custom merge
- **CRDT support** - Conflict-free replicated data types for automatic conflict resolution
- **Cross-tab sync** - Changes sync instantly across browser tabs
- **SSR support** - Server-side rendering with data preloading
- **Network resilience** - Automatic retry with exponential backoff
- **Extensible** - Custom actions, queries, subscriptions, and middleware

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                       │
│                   (Your React Components)                    │
└────────────────────┬───────────────────────┬────────────────┘
                     │                       │
                     ▼                       ▼
       ┌─────────────────────┐   ┌─────────────────────┐
       │  @convex-rx/react   │   │   Direct Core API   │
       │  ─────────────────  │   │   ──────────────    │
       │  • useConvexRx      │   │   • createConvexRxDB│
       │  • Provider         │   │   • getSingleton... │
       │  • TanStack DB      │   │   • createBase...   │
       │  • SSR preload      │   └─────────┬───────────┘
       └─────────┬───────────┘             │
                 │                         │
                 └────────┬────────────────┘
                          ▼
       ┌──────────────────────────────────────────┐
       │         @convex-rx/core                  │
       │         ───────────────                  │
       │  Framework-agnostic middleware layer     │
       │                                          │
       │  • RxDB management                       │
       │  • Conflict resolution                   │
       │  • CRDT support                          │
       │  • Singleton management                  │
       │  • CRUD actions + middleware             │
       │  • Schema builders                       │
       │  • Convex function generator             │
       │  • Clock skew handling                   │
       │  • Network error handling                │
       └────────┬─────────────────┬───────────────┘
                │                 │
                ▼                 ▼
       ┌─────────────┐   ┌─────────────────┐
       │    RxDB     │   │  Convex Cloud   │
       │   (Local)   │◄─►│   (Backend)     │
       │             │   │                 │
       │  IndexedDB  │   │  • Database     │
       │  LocalStore │   │  • Functions    │
       │  Memory     │   │  • WebSocket    │
       └─────────────┘   └─────────────────┘
```

### Data Flow: Real-Time Sync

```
User Action (e.g., update task)
        │
        ▼
┌───────────────────┐
│ React Component   │
│ (useConvexRx)     │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  TanStack DB      │  ← Optimistic UI update
│  (Reactive State) │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  @convex-rx/core  │
│  ───────────────  │
│  • Middleware     │  ← beforeUpdate hooks
│  • Validation     │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  RxDB (Local)     │  ← Persist to IndexedDB
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Replication      │  ← Queue for sync
└────────┬──────────┘
         │
         ▼ (when online)
┌───────────────────┐
│  Convex Cloud     │  ← Push mutation
│  pushDocuments    │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Conflict         │  ← Server validates
│  Resolution       │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Change Stream    │  ← Notify all clients
│  (WebSocket)      │     via changeStream
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  pullDocuments    │  ← Fetch updated data
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  RxDB (Local)     │  ← Update local storage
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  TanStack DB      │  ← Reactive update
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  React Component  │  ← Re-render with new data
└───────────────────┘
```

### Cross-Tab Synchronization

```
┌─────────────┐          ┌─────────────┐          ┌─────────────┐
│   Tab 1     │          │   Tab 2     │          │   Tab 3     │
└──────┬──────┘          └──────┬──────┘          └──────┬──────┘
       │                        │                        │
       ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              Shared RxDB Instance (multiInstance mode)          │
│              ───────────────────────────────────────            │
│  • Single database shared across all tabs via BroadcastChannel  │
│  • Local changes propagate instantly to all tabs                │
│  • Remote changes from Convex sync to all tabs via WebSocket    │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
                              ▼
                     ┌─────────────────┐
                     │  Convex Cloud   │
                     │  (WebSocket)    │
                     └─────────────────┘
```

## Packages

### `@convex-rx/core`

**Framework-agnostic sync engine** - The heart of ConvexRx. Provides the middleware layer between RxDB and Convex.

**What it does:**
- Manages RxDB database lifecycle
- Handles bidirectional replication with Convex
- Provides conflict resolution strategies (server-wins, client-wins, last-write-wins, custom)
- CRDT support for conflict-free replication
- Singleton management to prevent duplicate instances
- CRUD action factory with middleware support
- Schema builders with property helpers
- Convex function generator (no manual replication code!)
- Clock skew detection and adjustment
- Network error handling with automatic retry

**Use when:**
- Building non-React applications (Vue, Svelte, vanilla JS)
- Need direct control over database lifecycle
- Building your own framework integration

**Key exports:**
- `createConvexRxDB()` - Main entry point for creating sync instance
- `generateConvexRxFunctions()` - Auto-generate Convex functions
- `createSchema()`, `property.*` - Type-safe schema builders
- `createLastWriteWinsHandler()`, `createServerWinsHandler()`, etc. - Conflict handlers
- `addCRDTToSchema()`, `createCRDTActions()` - CRDT support
- `getSingletonInstance()` - Singleton management

### `@convex-rx/react`

**React hooks with TanStack DB integration** - Pre-configured React wrapper around Core with sensible defaults.

**What it does:**
- Wraps Core with TanStack DB for reactive state management
- Provides `useConvexRx` hook for effortless data syncing
- Requires `ConvexRxProvider` for global configuration
- Automatic singleton management across all hooks
- SSR support with `preloadConvexRxData()`
- Optimistic UI updates out of the box
- Type-safe hooks with full TypeScript inference

**Use when:**
- Building React applications
- Want zero-config reactive state management
- Need SSR/SSG support (Next.js, Remix, TanStack Start)

**Key exports:**
- `useConvexRx()` - Main hook for syncing data
- `ConvexRxProvider` - REQUIRED provider for Convex client
- `preloadConvexRxData()` - SSR data preloading
- Re-exports all Core utilities (schemas, conflict handlers, etc.)

## Installation

```bash
# For React applications
bun add @convex-rx/react convex rxdb rxjs

# For other frameworks or direct Core usage
bun add @convex-rx/core convex rxdb rxjs
```

## Quick Start (React)

### Step 1: Wrap App with ConvexRxProvider (REQUIRED)

The provider is required to prevent module-level import timing issues and enable global configuration.

```typescript
// src/routes/__root.tsx (TanStack Start)
// or src/App.tsx (Vite/CRA)

import { ConvexRxProvider } from '@convex-rx/react';
import { ConvexReactClient } from 'convex/react';

const convexClient = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

export function App({ children }: { children: React.ReactNode }) {
  return (
    <ConvexRxProvider
      convexClient={convexClient}
      enableLogging={import.meta.env.DEV} // Enable logging in development
    >
      {children}
    </ConvexRxProvider>
  );
}
```

### Step 2: Generate Convex Functions (Auto-Generated!)

No manual replication code needed. The generator creates all required functions automatically.

```typescript
// convex/tasks.ts

import { generateConvexRxFunctions } from '@convex-rx/core/convex';
import { query, mutation } from './_generated/server';
import { v } from 'convex/values';

const { changeStream, pullDocuments, pushDocuments } = generateConvexRxFunctions({
  tableName: 'tasks',
  query,
  mutation,
  v,
});

export { changeStream, pullDocuments, pushDocuments };
```

**What this generates:**
- `changeStream` - Real-time change detection via WebSocket
- `pullDocuments` - Incremental sync with index support
- `pushDocuments` - Conflict-aware batch mutations

### Step 3: Define Schema

```typescript
// src/hooks/useTasks.ts

import {
  createSchema,
  property,
  addCRDTToSchema,
  type SyncedDocument,
} from '@convex-rx/react';

// Your document type (extends SyncedDocument)
export interface Task extends SyncedDocument {
  text: string;
  isCompleted: boolean;
  priority: 'low' | 'medium' | 'high';
}

// Create schema (sync fields added automatically)
const baseSchema = createSchema<Omit<Task, keyof SyncedDocument>>('tasks', {
  text: property.string({ maxLength: 500 }),
  isCompleted: property.boolean(),
  priority: property.string(),
});

// Optional: Add CRDT support for conflict-free replication
export const taskSchema = addCRDTToSchema(baseSchema);
```

**Required fields (added automatically by `SyncedDocument`):**
- `id` - Client-generated UUID
- `creationTime` - Timestamp when document was created
- `updatedTime` - Auto-managed by sync engine
- `_deleted` - Soft delete flag

### Step 4: Create Hook

```typescript
// src/hooks/useTasks.ts

import { useConvexRx } from '@convex-rx/react';
import { api } from '../convex/_generated/api';

export function useTasks(initialData?: Task[]) {
  return useConvexRx({
    table: 'tasks',
    schema: taskSchema,
    convexApi: {
      changeStream: api.tasks.changeStream,
      pullDocuments: api.tasks.pullDocuments,
      pushDocuments: api.tasks.pushDocuments,
    },
    initialData, // Optional SSR data

    // Optional: Custom actions
    actions: (base, ctx) => ({
      ...base, // insert, update, delete

      toggle: async (id: string) => {
        const task = await ctx.rxCollection.findOne(id).exec();
        if (task) {
          await base.update(id, { isCompleted: !task.isCompleted });
        }
      },
    }),

    // Optional: Custom queries
    queries: (ctx) => ({
      getCompleted: () => ctx.collection.toArray.filter((t) => t.isCompleted),
      getIncomplete: () => ctx.collection.toArray.filter((t) => !t.isCompleted),
    }),
  });
}
```

### Step 5: Use in Components

```typescript
// src/components/TaskList.tsx

import { useTasks } from '../hooks/useTasks';

export function TaskList() {
  const { data, status, actions, queries } = useTasks();

  if (status.error) {
    return <div>Error: {status.error.message}</div>;
  }

  if (status.isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <button
        onClick={() =>
          actions.insert({
            text: 'New task',
            isCompleted: false,
            priority: 'medium',
          })
        }
      >
        Add Task
      </button>

      <p>Completed: {queries.getCompleted().length}</p>

      {data.map((task) => (
        <div key={task.id}>
          <input
            type="checkbox"
            checked={task.isCompleted}
            onChange={() => actions.toggle(task.id)}
          />
          <span>{task.text}</span>
          <button onClick={() => actions.delete(task.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
```

## Advanced Usage

### Conflict Resolution

Choose a strategy that fits your use case:

```typescript
import {
  createLastWriteWinsHandler,
  createServerWinsHandler,
  createClientWinsHandler,
  createCustomMergeHandler,
} from '@convex-rx/react';

// 1. Last-Write-Wins (Default)
// Most recent change wins based on updatedTime
useConvexRx({
  // ...config
  conflictHandler: createLastWriteWinsHandler<Task>(),
});

// 2. Server Always Wins
// Server state takes precedence over client changes
useConvexRx({
  // ...config
  conflictHandler: createServerWinsHandler<Task>(),
});

// 3. Client Always Wins
// Client changes override server state
useConvexRx({
  // ...config
  conflictHandler: createClientWinsHandler<Task>(),
});

// 4. Custom Field-Level Merge
// Implement your own conflict resolution logic
useConvexRx({
  // ...config
  conflictHandler: createCustomMergeHandler<Task>((input) => ({
    ...input.realMasterState, // Server state
    text: input.newDocumentState.text, // Keep client's text
    isCompleted: input.realMasterState.isCompleted, // Keep server's status
    updatedTime: Math.max(
      input.realMasterState.updatedTime,
      input.newDocumentState.updatedTime
    ),
  })),
});
```

### CRDT Support (Conflict-Free Replication)

CRDTs automatically resolve conflicts without manual intervention. Perfect for collaborative editing.

```typescript
import { addCRDTToSchema, createCRDTActions } from '@convex-rx/react';

// 1. Add CRDT to schema
const baseSchema = createSchema<Task>('tasks', {
  text: property.string(),
  isCompleted: property.boolean(),
});

const taskSchema = addCRDTToSchema(baseSchema);

// 2. Use with hook (base actions automatically use CRDT)
export function useTasks() {
  return useConvexRx({
    table: 'tasks',
    schema: taskSchema, // CRDT-enabled schema
    convexApi: api.tasks,
    // Base actions (insert, update, delete) automatically use CRDT!
  });
}

// 3. Or use CRDT actions directly with Core
const actions = createCRDTActions({
  rxCollection,
  enableLogging: true,
});

await actions.insert({ text: 'Task', isCompleted: false });
await actions.update('task-id', { isCompleted: true });
```

### Middleware Hooks

Add cross-cutting concerns like logging, validation, or analytics:

```typescript
import type { MiddlewareConfig } from '@convex-rx/core';

const middleware: MiddlewareConfig<Task> = {
  beforeInsert: async (doc) => {
    console.log('Inserting:', doc);
    // Transform document before insert
    return { ...doc, createdBy: 'current-user' };
  },

  afterInsert: async (id) => {
    console.log('Inserted:', id);
    // Send analytics, show notification, etc.
  },

  beforeUpdate: async (id, updates) => {
    // Validate updates
    if (updates.text && updates.text.length > 500) {
      throw new Error('Text too long');
    }
    return updates;
  },

  afterUpdate: async (id, updates) => {
    console.log('Updated:', id, updates);
  },

  beforeDelete: async (id) => {
    // Confirm deletion
    const confirmed = window.confirm('Delete task?');
    if (!confirmed) throw new Error('Deletion cancelled');
  },

  afterDelete: async (id) => {
    console.log('Deleted:', id);
  },

  onSyncError: (error) => {
    console.error('Sync error:', error);
    // Show user-friendly error message
  },
};

useConvexRx({
  table: 'tasks',
  schema: taskSchema,
  convexApi: api.tasks,
  middleware,
});
```

### Server-Side Rendering (SSR)

Preload data on the server for instant page loads with zero loading states:

```typescript
// TanStack Start loader
import { createFileRoute } from '@tanstack/react-router';
import { preloadConvexRxData } from '@convex-rx/react/ssr';
import { api } from '../convex/_generated/api';

export const Route = createFileRoute('/tasks')({
  loader: async () => {
    const tasks = await preloadConvexRxData<Task>({
      convexUrl: import.meta.env.VITE_CONVEX_URL,
      convexApi: { pullDocuments: api.tasks.pullDocuments },
      batchSize: 300,
    });

    return { initialTasks: tasks };
  },
});

// Component
function TasksPage() {
  const { initialTasks } = Route.useLoaderData();

  const { data, status } = useTasks(initialTasks);
  // No loading state on first render!

  return <TaskList tasks={data} />;
}
```

### Storage Adapters

Choose the right storage backend for your use case:

```typescript
import { StorageType } from '@convex-rx/react';

// 1. Dexie.js (Default, Recommended)
// IndexedDB wrapper with 5-10x better performance
useConvexRx({
  // ...config
  storage: { type: StorageType.Dexie }, // or omit (default)
});

// 2. LocalStorage
// Simple key-value storage, limited to ~5MB
useConvexRx({
  // ...config
  storage: { type: StorageType.Localstorage },
});

// 3. Memory
// In-memory storage (data lost on page refresh)
// Useful for testing or temporary data
useConvexRx({
  // ...config
  storage: { type: StorageType.Memory },
});
```

### Error Handling

ConvexRx provides strongly-typed error objects with recovery strategies:

```typescript
import { ErrorCategory, ErrorSeverity } from '@convex-rx/react';

function TaskList() {
  const { data, status } = useTasks();

  if (status.error) {
    const { error } = status;

    // Check error category
    if (error.category === ErrorCategory.NETWORK) {
      return (
        <div>
          Network error. Your changes are saved locally and will sync when online.
        </div>
      );
    }

    if (error.category === ErrorCategory.VALIDATION) {
      return <div>Invalid data: {error.message}</div>;
    }

    // Check severity
    if (error.severity === ErrorSeverity.CRITICAL) {
      return <div>Critical error. Please reload the page.</div>;
    }

    // Default fallback
    return <div>Error: {error.message}</div>;
  }

  // ... rest of component
}
```

**Error Categories:**
- `ErrorCategory.NETWORK` - Network connectivity issue
- `ErrorCategory.VALIDATION` - Schema validation failed
- `ErrorCategory.CONFLICT` - Conflict during sync
- `ErrorCategory.STORAGE` - Local storage error
- `ErrorCategory.REPLICATION` - Sync error
- `ErrorCategory.INITIALIZATION` - Database setup failed

**Error Severities:**
- `ErrorSeverity.LOW` - Informational, no action needed
- `ErrorSeverity.MEDIUM` - Warning, operation may retry
- `ErrorSeverity.HIGH` - Error, user should be notified
- `ErrorSeverity.CRITICAL` - Fatal error, requires user action

## API Reference

### `@convex-rx/react`

#### `useConvexRx<T>(config)`

Main hook for syncing data with Convex. Provides reactive state, actions, queries, and subscriptions.

**Config:**

```typescript
interface UseConvexRxConfig<T> {
  // Required
  table: string;
  schema: RxJsonSchema<T>;
  convexApi: {
    changeStream: ConvexQuery;
    pullDocuments: ConvexQuery;
    pushDocuments: ConvexMutation;
  };

  // Optional - Configuration
  databaseName?: string; // Default: 'convex-rx-db'
  batchSize?: number; // Pull batch size, default: 100
  pushBatchSize?: number; // Push batch size, default: 100
  enableLogging?: boolean; // Override provider setting
  conflictHandler?: RxConflictHandler<T>;
  storage?: StorageConfig; // Default: Dexie
  multiInstance?: boolean; // Cross-tab sync, default: true

  // Optional - Extensions
  actions?: (base: BaseActions<T>, ctx: HookContext<T>) => TActions;
  queries?: (ctx: HookContext<T>) => TQueries;
  subscriptions?: (ctx: HookContext<T>) => TSubscriptions;
  middleware?: MiddlewareConfig<T>;

  // Optional - SSR
  initialData?: T[];
}
```

**Returns:**

```typescript
interface UseConvexRxResult<T> {
  // Reactive data
  data: T[];

  // Status
  status: {
    isLoading: boolean; // Initial data load
    isReady: boolean; // Database ready
    isReplicating: boolean; // Actively syncing
    error: ConvexRxError | null;
  };

  // Base actions (always available)
  actions: {
    insert: (doc: Omit<T, 'id' | 'creationTime' | 'updatedTime' | '_deleted'>) => Promise<string>;
    update: (id: string, updates: Partial<Omit<T, 'id' | 'creationTime' | 'updatedTime' | '_deleted'>>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    // ...plus any custom actions
  };

  // Custom queries
  queries: TQueries;

  // Custom subscriptions
  subscribe: TSubscriptions;

  // Advanced access
  collection: Collection<T> | null; // TanStack DB collection
  rxCollection: RxCollection<T> | null; // RxDB collection
  replicationState: RxReplicationState<T> | null; // Replication state
  purgeStorage: () => Promise<void>; // Clear local storage
}
```

#### `ConvexRxProvider`

**Required** provider for Convex client configuration. Must wrap your app root.

```typescript
interface ConvexRxProviderProps {
  convexClient: ConvexClient;
  enableLogging?: boolean; // Default: false
  children: React.ReactNode;
}

// Usage
import { ConvexRxProvider } from '@convex-rx/react';
import { ConvexReactClient } from 'convex/react';

const convexClient = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

<ConvexRxProvider convexClient={convexClient} enableLogging={true}>
  <App />
</ConvexRxProvider>;
```

#### `preloadConvexRxData<T>(config)`

Preload data on the server for SSR/SSG.

```typescript
interface PreloadConvexRxDataConfig {
  convexUrl: string;
  convexApi: {
    pullDocuments: ConvexQuery;
  };
  batchSize?: number; // Default: 100
}

// Returns: Promise<T[]>
const tasks = await preloadConvexRxData<Task>({
  convexUrl: process.env.VITE_CONVEX_URL,
  convexApi: { pullDocuments: api.tasks.pullDocuments },
  batchSize: 300,
});
```

### `@convex-rx/core`

#### `createConvexRxDB<T>(config)`

Create a ConvexRx sync instance. Framework-agnostic, use with any JavaScript framework.

```typescript
interface ConvexRxDBConfig<T> {
  databaseName: string;
  collectionName: string;
  schema: RxJsonSchema<T>;
  convexClient: ConvexClient;
  convexApi: {
    changeStream: ConvexQuery;
    pullDocuments: ConvexQuery;
    pushDocuments: ConvexMutation;
  };
  conflictHandler?: RxConflictHandler<T>;
  batchSize?: number;
  pushBatchSize?: number;
  enableLogging?: boolean;
  storage?: StorageConfig;
  multiInstance?: boolean;
  middleware?: MiddlewareConfig<T>;
}

// Returns
interface ConvexRxDBInstance<T> {
  db: RxDatabase;
  collection: RxCollection<T>;
  replicationState: RxReplicationState<T>;
  actions: BaseActions<T>;
  cleanup: () => Promise<void>;
}

// Usage
import { createConvexRxDB } from '@convex-rx/core';

const instance = await createConvexRxDB({
  databaseName: 'my-app',
  collectionName: 'tasks',
  schema: taskSchema,
  convexClient,
  convexApi: {
    changeStream: api.tasks.changeStream,
    pullDocuments: api.tasks.pullDocuments,
    pushDocuments: api.tasks.pushDocuments,
  },
});

// Use RxDB directly
const tasks = await instance.collection.find().exec();
await instance.actions.insert({ text: 'New task', isCompleted: false });

// Cleanup when done
await instance.cleanup();
```

#### `generateConvexRxFunctions(config)`

Auto-generate Convex functions for replication. No manual code needed!

```typescript
interface GenerateConvexRxFunctionsConfig {
  tableName: string;
  query: QueryBuilder;
  mutation: MutationBuilder;
  v: ValidatorBuilder;
}

// Returns
interface GeneratedFunctions {
  changeStream: ConvexQuery;
  pullDocuments: ConvexQuery;
  pushDocuments: ConvexMutation;
}

// Usage in convex/tasks.ts
import { generateConvexRxFunctions } from '@convex-rx/core/convex';
import { query, mutation } from './_generated/server';
import { v } from 'convex/values';

const { changeStream, pullDocuments, pushDocuments } = generateConvexRxFunctions({
  tableName: 'tasks',
  query,
  mutation,
  v,
});

export { changeStream, pullDocuments, pushDocuments };
```

#### `createSchema<T>(name, properties)`

Type-safe schema builder with property helpers.

```typescript
import { createSchema, property } from '@convex-rx/core';

interface Task {
  text: string;
  isCompleted: boolean;
  tags: string[];
  metadata: {
    createdBy: string;
    priority: number;
  };
}

const schema = createSchema<Task>('tasks', {
  text: property.string({ maxLength: 500 }),
  isCompleted: property.boolean(),
  tags: property.array(property.string()),
  metadata: property.object({
    createdBy: property.string(),
    priority: property.number({ min: 1, max: 5, integer: true }),
  }),
});
```

**Property Builders:**

```typescript
// String
property.string({ maxLength?: number })

// Number
property.number({ min?: number, max?: number, integer?: boolean })
property.positiveNumber({ max?: number, integer?: boolean })

// Boolean
property.boolean()

// Array
property.array(itemDefinition: PropertyDefinition)

// Object
property.object(properties: Record<string, PropertyDefinition>)
```

#### Conflict Handlers

```typescript
// Last-Write-Wins (default)
createLastWriteWinsHandler<T>(enableLogging?: boolean)

// Server-Wins
createServerWinsHandler<T>(enableLogging?: boolean)

// Client-Wins
createClientWinsHandler<T>(enableLogging?: boolean)

// Custom Merge
createCustomMergeHandler<T>(
  mergeFn: (input: RxConflictHandlerInput<T>) => T | Promise<T>,
  options?: {
    onError?: (error: Error, input: RxConflictHandlerInput<T>) => void | Promise<void>;
    fallbackStrategy?: 'server-wins' | 'client-wins';
    enableLogging?: boolean;
  }
)

// Field-Level Merge
createFieldLevelMergeHandler<T>(
  fieldStrategy: (field: keyof T) => 'server' | 'client' | 'merge',
  options?: { enableLogging?: boolean }
)
```

#### CRDT Support

```typescript
// Add CRDT to schema
addCRDTToSchema<T>(schema: RxJsonSchema<T>): RxJsonSchema<T>

// Create CRDT actions
createCRDTActions<T>(config: {
  rxCollection: RxCollection<T>;
  enableLogging?: boolean;
}): BaseActions<T>

// Get CRDT schema part (for manual schema building)
getCRDTSchemaPart(): PropertyDefinition
```

#### Singleton Management

```typescript
// Get or create singleton
getSingletonInstance<TConfig, TInstance>(
  config: TConfig,
  options: {
    keyFn: (config: TConfig) => string;
    createFn: (config: TConfig) => Promise<TInstance>;
  }
): Promise<TInstance>

// Create singleton key
createSingletonKey(databaseName: string, collectionName: string): string

// Check if singleton exists
hasSingletonInstance(key: string): boolean

// Remove singleton
removeSingletonInstance(key: string): void

// Clear all singletons
clearAllSingletons(): void
```

## Core Package Usage (Non-React)

If you're not using React, you can use the Core package directly:

```typescript
import { createConvexRxDB, getSingletonInstance, createSingletonKey } from '@convex-rx/core';
import { ConvexClient } from 'convex/browser';

// 1. Create Convex client
const convexClient = new ConvexClient(import.meta.env.VITE_CONVEX_URL);

// 2. Define schema
const taskSchema = createSchema<Task>('tasks', {
  text: property.string(),
  isCompleted: property.boolean(),
});

// 3. Create or get singleton instance
const instance = await getSingletonInstance(
  {
    databaseName: 'my-app',
    collectionName: 'tasks',
    schema: taskSchema,
    convexClient,
    convexApi: {
      changeStream: api.tasks.changeStream,
      pullDocuments: api.tasks.pullDocuments,
      pushDocuments: api.tasks.pushDocuments,
    },
  },
  {
    keyFn: (cfg) => createSingletonKey(cfg.databaseName, cfg.collectionName),
    createFn: async (cfg) => await createConvexRxDB(cfg),
  }
);

// 4. Use RxDB and actions directly
const { collection, actions, replicationState } = instance;

// Subscribe to changes
collection.find().$.subscribe((tasks) => {
  console.log('Tasks updated:', tasks);
});

// CRUD operations
const taskId = await actions.insert({
  text: 'Buy groceries',
  isCompleted: false,
});

await actions.update(taskId, { isCompleted: true });
await actions.delete(taskId);

// Monitor sync status
replicationState.active$.subscribe((isActive) => {
  console.log('Replicating:', isActive);
});

replicationState.error$.subscribe((error) => {
  console.error('Sync error:', error);
});

// Cleanup when done
await instance.cleanup();
```

## Development

### Building Packages

```bash
bun run build         # Build all packages (core → react)
bun run build:core    # Build core only
bun run build:react   # Build React only
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

## Examples

Complete working example: `examples/tanstack-start/`

**Files to explore:**
- `src/useTasks.ts` - Hook with custom actions and queries
- `src/routes/index.tsx` - Component usage
- `src/routes/__root.tsx` - ConvexRxProvider setup
- `convex/tasks.ts` - Auto-generated Convex functions

## TypeScript Best Practices

This library follows strict TypeScript standards:

- **Zero `any` types** - Use `unknown` for truly unknown values
- **Const object pattern** instead of enums
- **Explicit return types** on exported functions
- **Trust TypeScript** - No redundant runtime checks for typed values
- **Proper generic constraints** for type safety

See `CLAUDE.md` for detailed coding standards.

## Offline Behavior

### How It Works

- **Writes** - Queue locally in RxDB, sync when online
- **Reads** - Always work from local RxDB cache (instant!)
- **UI** - Fully functional with optimistic updates
- **Conflicts** - Auto-resolved when reconnected based on your conflict handler

### Network Resilience

- Automatic retry with exponential backoff
- Network error detection (fetch errors, connection issues)
- Queue changes while offline
- Graceful degradation

### Cross-Tab Sync

- Single shared RxDB instance across browser tabs (multiInstance mode)
- Local changes propagate instantly via BroadcastChannel
- Remote changes from Convex sync to all tabs via WebSocket

## Performance

### Storage Performance

| Storage | Read | Write | Use Case |
|---------|------|-------|----------|
| **Dexie** (Default) | 5-10x faster | 5-10x faster | Production (recommended) |
| **LocalStorage** | Slower | Slower | Simple apps, limited data |
| **Memory** | Fastest | Fastest | Testing, temporary data |

### Sync Performance

- **Batch operations** - Configurable batch sizes for pull/push
- **Indexed queries** - Convex indexes for fast incremental sync
- **Change streams** - WebSocket-based real-time updates
- **Optimistic UI** - Instant updates without waiting for server

## Roadmap

- [ ] Partial sync (sync subset of collection)
- [ ] Delta sync (only sync changed fields)
- [ ] Encryption at rest
- [ ] Attachment support (files, images)
- [ ] Vue/Svelte wrappers
- [ ] React Native support
- [ ] Advanced CRDT types (counters, sets, maps)

## Contributing

Contributions welcome! Please see `CLAUDE.md` for coding standards.

## License

MIT License - see LICENSE file for details.
