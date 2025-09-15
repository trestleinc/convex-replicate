# TanStack DB + RxDB + Convex Sync Engine

A complete offline-first sync solution that combines the power of **Convex** (real-time backend), **RxDB** (local database), and **TanStack DB** (reactive state management) into a clean, type-safe, and composable API.

## 🚀 Features

- ✅ **Offline-first** - Works without internet, syncs when reconnected
- ✅ **Real-time sync** - Convex stream-based bidirectional synchronization
- ✅ **Type-safe** - Full TypeScript support throughout the pipeline  
- ✅ **Composable** - One API works with any Convex table
- ✅ **Conflict resolution** - Server-wins strategy with automatic handling
- ✅ **Cross-tab sync** - Changes sync across browser tabs
- ✅ **Hot reload safe** - Proper cleanup during development

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  React          │    │  TanStack DB    │    │  RxDB           │
│  Components     │◄──►│  Collections    │◄──►│  Local Storage  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │  Sync Engine    │◄──►│  Replication    │
                       │  (Our API)      │    │  State Machine  │
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

## 📦 Quick Setup

### 1. Install Dependencies

```bash
bun install
# The following packages are required:
# - @tanstack/react-db
# - @tanstack/rxdb-db-collection  
# - rxdb
# - convex
```

### 2. Import Sample Data

```bash
bunx convex import --table tasks sampleData.jsonl
```

### 3. Start Development

```bash
bun run dev
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
import React from "react";
import { createConvexSync, type RxJsonSchema } from "./sync/createConvexSync";
import { useConvexSync } from "./sync/useConvexSync";
import { api } from "../convex/_generated/api";

// Define your data type
export type YourItem = {
  id: string;
  name: string; // Your custom fields
  description: string;
  updatedTime: number; // Required for sync
  _deleted?: boolean; // Required for soft deletes
};

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

// Sync instance management (singleton pattern)
let syncInstance: Promise<any> | null = null;

async function getYourSync() {
  if (!syncInstance) {
    syncInstance = createConvexSync<YourItem>({
      tableName: 'yourTable',
      schema: yourSchema,
      convexApi: {
        changeStream: api.yourTable.changeStream,
        pullDocuments: api.yourTable.pullDocuments,
        pushDocuments: api.yourTable.pushDocuments
      }
    });
  }
  return syncInstance;
}

// Main hook
export function useYourTable() {
  const [syncInstance, setSyncInstance] = React.useState<any>(null);

  React.useEffect(() => {
    getYourSync().then(setSyncInstance);
  }, []);

  const syncResult = useConvexSync<YourItem>(syncInstance);

  if (!syncInstance) {
    return {
      data: [],
      isLoading: true,
      error: 'Initializing...',
      actions: {
        insert: async () => { throw new Error('Not initialized'); },
        update: async () => { throw new Error('Not initialized'); },
        delete: async () => { throw new Error('Not initialized'); }
      }
    };
  }

  return syncResult;
}
```

### 3. Use in React Components

```typescript
// src/components/YourComponent.tsx
import { useYourTable } from '../useYourTable';

export function YourComponent() {
  const { data, isLoading, error, actions } = useYourTable();

  const handleCreate = async () => {
    await actions.insert({
      name: "New item",
      description: "Item description"
      // id and updatedTime are auto-generated
    });
  };

  const handleUpdate = async (id: string) => {
    await actions.update(id, {
      name: "Updated name"
    });
  };

  const handleDelete = async (id: string) => {
    await actions.delete(id);
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

### `createConvexSync<T>(config)`

Creates a sync instance for any Convex table.

```typescript
interface ConvexSyncConfig<T> {
  tableName: string;
  schema: RxJsonSchema<T>;
  convexApi: {
    changeStream: any; // Convex function reference
    pullDocuments: any; // Convex function reference  
    pushDocuments: any; // Convex function reference
  };
  databaseName?: string; // Default: `${tableName}db`
  batchSize?: number; // Default: 100
  retryTime?: number; // Default: 5000
  enableLogging?: boolean; // Default: true
}
```

### `useConvexSync<T>(syncInstance)`

Generic React hook for using any sync instance.

```typescript
interface UseConvexSyncResult<T> {
  data: T[]; // Reactive data array
  isLoading: boolean; // Loading state
  error?: string; // Error message if any
  collection: any | null; // TanStack collection instance
  actions: {
    insert: (itemData: Omit<T, 'id' | 'updatedTime' | '_deleted'>) => Promise<string>;
    update: (id: string, updates: Partial<Omit<T, 'id' | 'updatedTime' | '_deleted'>>) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };
}
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
// Simple one-line setup  
const syncInstance = await createConvexSync({
  tableName: 'yourTable',
  schema: yourSchema,
  convexApi: api.yourTable
});
```

### From Other State Management

The sync engine provides a complete replacement for:
- **Redux/Zustand**: TanStack DB handles reactive state
- **React Query**: Built-in caching and background sync
- **Manual real-time connections**: Automatic Convex stream updates
- **Local storage**: RxDB provides structured local database

## 📚 Examples

- **`src/useTasks.ts`** - Complete task management implementation with CRUD operations
- **`src/sync/README.md`** - Detailed API documentation with advanced examples

## 🤝 Contributing

This sync engine demonstrates a complete offline-first architecture. Feel free to extend it for your specific use cases or contribute improvements to the core sync logic.

## 📄 License

MIT License - see the existing license in this repository.