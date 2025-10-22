# Convex RX - Offline-First Sync for React

A complete offline-first sync solution that combines **Convex** (real-time backend), **RxDB** (local database), and **TanStack DB** (reactive state management) into clean, type-safe, composable packages.

## 🚀 Features

- ✅ **Offline-first** - Works without internet, syncs when reconnected
- ✅ **Real-time sync** - Convex stream-based bidirectional synchronization
- ✅ **Type-safe** - Full TypeScript support throughout the pipeline
- ✅ **Composable** - One API works with any Convex table
- ✅ **Conflict resolution** - Server-wins strategy with automatic handling
- ✅ **Cross-tab sync** - Changes sync across browser tabs
- ✅ **Framework agnostic core** - Use with React, or extend for other frameworks

## 📦 Packages

This is a monorepo containing:

### `@convex-rx/core`
Framework-agnostic sync engine combining RxDB + Convex replication.
- No React dependencies
- Works with any JavaScript framework
- Handles bidirectional sync, conflict resolution, offline queueing
- Provides reusable utilities: singleton management, middleware, action factory, subscriptions
- ~614 lines of framework-agnostic code

### `@convex-rx/react`
React-specific bindings with TanStack DB integration.
- Thin wrapper consuming core utilities (~550 lines)
- React hooks for data subscriptions with automatic singleton management
- Optimistic UI updates
- CRUD actions with type safety
- Built on TanStack DB for reactive state
- Extensible via custom actions, queries, and subscriptions

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  React          │    │  TanStack DB    │    │  RxDB           │
│  Components     │◄──►│  Collections    │◄──►│  Local Storage  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │ @convex-rx/react│◄──►│ @convex-rx/core │
                       │  (React Hooks)  │    │  (Sync Engine)  │
                       └─────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │  Convex Streams │◄──►│  Change Stream  │
                       │  Real-time      │    │  Detection      │
                       └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │  Convex         │
                       │  Cloud Database │
                       └─────────────────┘
```

## 📦 Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Build Packages

```bash
bun run build
```

### 3. Run Example

```bash
# Set up Convex backend
cd examples/tanstack-start
cp .env.example .env
# Edit .env and add your VITE_CONVEX_URL

# Import sample data (convex dev must be running first)
bunx convex import --table tasks sampleData.jsonl

# Start both development server and Convex backend
cd ../..
bun run dev:example
# This runs both Vite dev server (port 3000) and Convex dev environment
```

## 🔧 How to Use

### 1. Set up Convex Functions

For any table you want to sync, create these three Convex functions:

```typescript
// convex/yourTable.ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Change stream for real-time updates
export const changeStream = query({
  args: {},
  handler: async (ctx) => {
    const allItems = await ctx.db.query("yourTable").order("desc").collect();
    const latestTime = allItems.length > 0 ? allItems[0].updatedTime : Date.now();
    
    return {
      timestamp: latestTime,
      count: allItems.length
    };
  },
});

// Pull documents for replication
export const pullDocuments = query({
  args: {
    checkpointTime: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, { checkpointTime, limit }) => {
    const items = await ctx.db
      .query("yourTable")
      .filter((q) => q.gt(q.field("updatedTime"), checkpointTime))
      .order("desc")
      .take(limit);
    
    return items.map(item => ({
      id: item.id,
      // ... other fields
      updatedTime: item.updatedTime
    }));
  },
});

// Push documents for replication
export const pushDocuments = mutation({
  args: {
    changeRows: v.array(v.object({
      newDocumentState: v.object({
        id: v.string(),
        // ... your fields
        updatedTime: v.number(),
        _deleted: v.optional(v.boolean())
      }),
      assumedMasterState: v.optional(v.object({
        id: v.string(),
        // ... your fields  
        updatedTime: v.number(),
        _deleted: v.optional(v.boolean())
      }))
    }))
  },
  handler: async (ctx, { changeRows }) => {
    // Handle conflicts and updates
    // See convex/tasks.ts for complete implementation
    return conflicts;
  },
});
```

### 2. Create Your Sync Hook

```typescript
// src/useYourTable.ts
import { useConvexRx, type SyncedDocument } from "@convex-rx/react";
import type { RxJsonSchema } from "@convex-rx/core";
import { api } from "../convex/_generated/api";

// Define your data type (extends SyncedDocument for id, updatedTime, _deleted)
export type YourItem = {
  name: string; // Your custom fields
  description: string;
} & SyncedDocument;

// Define RxDB schema
const yourSchema: RxJsonSchema<YourItem> = {
  title: 'YourItem Schema',
  version: 0,
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: { type: 'string', maxLength: 100 },
    name: { type: 'string' },
    description: { type: 'string' },
    updatedTime: {
      type: 'number',
      minimum: 0,
      maximum: 8640000000000000,
      multipleOf: 1
    }
  },
  required: ['id', 'name', 'description', 'updatedTime'],
  indexes: [['updatedTime', 'id']]
};

// Main hook - singleton management is automatic!
export function useYourTable() {
  return useConvexRx({
    table: 'yourTable',
    schema: yourSchema,
    convexApi: {
      changeStream: api.yourTable.changeStream,
      pullDocuments: api.yourTable.pullDocuments,
      pushDocuments: api.yourTable.pushDocuments
    }
  });
}
```

### 3. Use in React Components

```typescript
// src/components/YourComponent.tsx
import { useYourTable } from '../useYourTable';

export function YourComponent() {
  const { data, isLoading, error, insert, update, delete: remove } = useYourTable();

  const handleCreate = async () => {
    await insert({
      name: "New item",
      description: "Item description"
      // id and updatedTime are auto-generated
    });
  };

  const handleUpdate = async (id: string) => {
    await update(id, {
      name: "Updated name"
    });
  };

  const handleDelete = async (id: string) => {
    await remove(id);
  };

  if (error) return <div>Error: {error}</div>;
  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <button onClick={handleCreate}>Create Item</button>
      {data.map(item => (
        <div key={item.id}>
          <h3>{item.name}</h3>
          <p>{item.description}</p>
          <button onClick={() => handleUpdate(item.id)}>Update</button>
          <button onClick={() => handleDelete(item.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
```

## 🔍 How It Works

### Real-time Sync Flow

1. **Local Changes**: User modifies data in React component
2. **TanStack DB**: Reactive collection updates immediately (optimistic UI)
3. **RxDB**: Local database stores the change
4. **Replication**: Push changes to Convex in the background
5. **Convex Streams**: Convex broadcasts changes via reactive queries to all connected clients
6. **Change Detection**: Other clients detect changes via Convex query streams
7. **Pull Sync**: Clients pull new data from Convex
8. **Conflict Resolution**: Server-wins strategy resolves any conflicts

### Offline Behavior

- ✅ **Writes**: Queue locally in RxDB, sync when online
- ✅ **Reads**: Always work from local RxDB cache
- ✅ **UI**: Remains fully functional with optimistic updates
- ✅ **Conflicts**: Automatically resolved when reconnected

### Cross-tab Sync

- ✅ **Local changes**: Sync instantly across browser tabs
- ✅ **Remote changes**: Propagate via Convex streams to all tabs
- ✅ **Database sharing**: Single RxDB instance shared across tabs

## 📋 API Reference

### `useConvexRx<T>(config)` (from `@convex-rx/react`)

Main React hook with automatic singleton management and reactive state.

```typescript
interface UseConvexRxConfig<T> {
  // Required
  table: string;
  schema: RxJsonSchema<T>;
  convexApi: {
    changeStream: any; // Convex query function
    pullDocuments: any; // Convex query function
    pushDocuments: any; // Convex mutation function
  };

  // Optional - Client Config
  convexClient?: ConvexClient; // Required if not using ConvexRxProvider
  databaseName?: string; // Default: table name
  batchSize?: number; // Default: 50
  enableLogging?: boolean; // Default: false
  conflictHandler?: RxConflictHandler<T>; // Default: last-write-wins

  // Optional - Extensions
  actions?: (base, ctx) => TActions; // Custom action builder
  queries?: (ctx) => TQueries; // Custom query builder
  subscriptions?: (ctx) => TSubscriptions; // Custom subscription builder
  middleware?: MiddlewareConfig<T>; // Before/after hooks
}

interface UseConvexRxResult<T> {
  // Data
  data: T[]; // Reactive data array (filtered to exclude _deleted: true)
  isLoading: boolean; // Loading state
  error: string | null; // Error message if any

  // Base Actions (always available)
  insert: (data: Omit<T, 'id' | 'updatedTime' | '_deleted'>) => Promise<string>;
  update: (id: string, updates: Partial<Omit<T, 'id' | 'updatedTime' | '_deleted'>>) => Promise<void>;
  delete: (id: string) => Promise<void>;

  // Custom Extensions
  actions: TActions; // Custom actions if provided
  queries: TQueries; // Custom queries if provided
  subscribe: TSubscriptions; // Custom subscriptions if provided

  // Advanced Access
  collection: Collection<T> | null; // TanStack DB collection
  rxCollection: RxCollection<T> | null; // RxDB collection
  replicationState: RxReplicationState<T> | null; // Replication state observables
  purgeStorage: () => Promise<void>; // Purge local storage and reload
}
```

### Core Utilities (from `@convex-rx/core`)

Framework-agnostic utilities used internally by React package:

```typescript
// Singleton management
getSingletonInstance<TConfig, TInstance>(config, singleton): Promise<TInstance>
createSingletonKey(dbName, collectionName): string
removeSingletonInstance(key): void

// Base CRUD actions
createBaseActions<T>(context): BaseActions<T>

// Middleware
wrapActionsWithMiddleware<T>(actions, middleware): BaseActions<T>
setupSyncErrorMiddleware(replicationState, middleware): (() => void) | null

// Subscriptions
buildSubscriptions<TContext, TSubscriptions>(builder, context): TSubscriptions
```

### Required Data Type Structure

Your data types must include these fields:

```typescript
type YourData = {
  id: string; // Primary key (auto-generated)
  updatedTime: number; // For replication (auto-generated/updated)
  _deleted?: boolean; // For soft deletes (managed automatically)
  // ... your custom fields
};
```

## 🛠️ Development

### Running the Example

The included task manager demonstrates the sync engine:

```bash
# Install dependencies
bun install

# Import sample data  
bunx convex import --table tasks sampleData.jsonl

# Start development server
bun run dev
```

### Debugging

Enable detailed logging:

```typescript
const syncInstance = createConvexSync({
  // ... other config
  enableLogging: true // Detailed console logging
});
```

### Testing Offline Mode

1. Open the app in your browser
2. Open DevTools → Network tab
3. Set throttling to "Offline"
4. Continue using the app normally
5. Set back to "Online" to see sync resume

## 🔄 Migration Guide

### From Direct RxDB

**Before:**
```typescript
// Complex manual setup
const db = await createRxDatabase(/* complex config */);
const collection = await db.addCollections(/* schemas */);
const replication = replicateRxCollection(/* complex replication setup */);
```

**After:**
```typescript
// Simple hook with automatic singleton management
export function useYourTable() {
  return useConvexRx({
    table: 'yourTable',
    schema: yourSchema,
    convexApi: api.yourTable
  });
}
```

### From Other State Management

The sync engine provides a complete replacement for:
- **Redux/Zustand**: TanStack DB handles reactive state
- **React Query**: Built-in caching and background sync
- **Manual real-time connections**: Automatic Convex stream updates
- **Local storage**: RxDB provides structured local database

### Adding Multi-Framework Support

With the Phase 1-2 migration complete, adding support for new frameworks is straightforward:

1. **Core utilities are ready** (~614 lines reusable across any framework)
2. **Create new package** (e.g., `@convex-rx/svelte`)
3. **Implement framework wrapper** (~1-2 hours):
   - Framework-specific reactive wrapper (Svelte stores, Vue refs, etc.)
   - Use core utilities: `getSingletonInstance`, `createBaseActions`, `wrapActionsWithMiddleware`
4. **Reuse 40% of codebase** - Core handles sync, conflicts, middleware, subscriptions

See `MIGRATION.md` for detailed multi-framework architecture guide.

## 📚 Examples

See **`examples/tanstack-start/`** for a complete working example:
- **`src/useTasks.ts`** - Complete task management implementation with CRUD operations
- **`convex/tasks.ts`** - Convex backend functions (changeStream, pullDocuments, pushDocuments)
- **`src/routes/index.tsx`** - React component using the sync hook

## 🛠️ Development

### Building Packages

```bash
# Build all packages
bun run build

# Build individual packages
bun run build:core
bun run build:react
```

### Running Tests

```bash
bun run typecheck
```

### Code Quality

```bash
bun run check        # Check formatting and linting
bun run check:fix    # Auto-fix issues
```

## 🤝 Contributing

This project demonstrates a complete offline-first architecture with a clean separation between framework-agnostic core and React-specific bindings. Feel free to extend it for other frameworks or contribute improvements to the core sync logic.

## 📄 License

MIT License - see the existing license in this repository.