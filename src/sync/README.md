# TanStack DB + RxDB + Convex Sync API

A clean, type-safe, and composable API for syncing any Convex table with TanStack DB and RxDB for offline-first applications.

## 🚀 Quick Start

### 1. Set up Convex Functions

First, create the required Convex functions for your table. Here's the pattern for any table:

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
    const conflicts = [];
    
    for (const changeRow of changeRows) {
      const { newDocumentState, assumedMasterState } = changeRow;
      
      // Find current document
      const currentDoc = await ctx.db
        .query("yourTable")
        .filter((q) => q.eq(q.field("id"), newDocumentState.id))
        .first();
      
      // Handle conflicts and updates (see tasks.ts for full implementation)
      // ...
    }
    
    return conflicts;
  },
});
```

### 2. Create Your Hook

```typescript
// src/useYourTable.ts
import React from "react";
import { createConvexSync, type RxJsonSchema } from "./sync/createConvexSync";
import { useConvexSync } from "./sync/useConvexSync";
import { api } from "../convex/_generated/api";

// Define your data type
export type YourItem = {
  id: string;
  // ... your fields
  updatedTime: number;
  _deleted?: boolean;
};

// Define RxDB schema
const yourSchema: RxJsonSchema<YourItem> = {
  title: 'YourItem Schema',
  version: 0,
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: { type: 'string', maxLength: 100 },
    // ... your field definitions
    updatedTime: {
      type: 'number',
      minimum: 0,
      maximum: 8640000000000000,
      multipleOf: 1
    }
  },
  required: ['id', 'updatedTime'],
  indexes: [['updatedTime', 'id']]
};

// Sync instance management
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

### 3. Use in Components

```typescript
// src/components/YourComponent.tsx
import { useYourTable } from '../useYourTable';

export function YourComponent() {
  const { data, isLoading, error, actions } = useYourTable();

  const handleCreate = async () => {
    await actions.insert({
      // your fields (id and updatedTime are auto-generated)
    });
  };

  const handleUpdate = async (id: string) => {
    await actions.update(id, {
      // your updates
    });
  };

  const handleDelete = async (id: string) => {
    await actions.delete(id);
  };

  if (error) return <div>Error: {error}</div>;
  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      {data.map(item => (
        <div key={item.id}>
          {/* Your item display */}
        </div>
      ))}
    </div>
  );
}
```

## 📚 API Reference

### `createConvexSync<T>(config)`

Creates a sync instance for a Convex table.

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

**Returns:** Promise resolving to sync instance with TanStack collection, RxDB collection, database, and replication state.

### `useConvexSync<T>(syncInstance)`

Generic React hook for using any sync instance.

```typescript
interface UseConvexSyncResult<T> {
  data: T[]; // Reactive data array
  isLoading: boolean; // Loading state
  error?: string; // Error message if any
  collection: any | null; // TanStack collection instance
  actions: {
    insert: (itemData: Omit<T, 'id'>) => Promise<string>;
    update: (id: string, updates: Partial<Omit<T, 'id'>>) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };
}
```

### Required Data Type Structure

Your data types must include these fields:

```typescript
type YourData = {
  id: string; // Primary key (auto-generated if not provided)
  updatedTime: number; // For replication (auto-generated/updated)
  _deleted?: boolean; // For soft deletes (managed automatically)
  // ... your custom fields
};
```

## 🔧 Advanced Usage

### Custom Schemas

```typescript
const complexSchema: RxJsonSchema<ComplexType> = {
  title: 'Complex Schema',
  version: 0,
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: { type: 'string', maxLength: 100 },
    nested: {
      type: 'object',
      properties: {
        field1: { type: 'string' },
        field2: { type: 'number' }
      }
    },
    arrayField: {
      type: 'array',
      items: { type: 'string' }
    },
    updatedTime: {
      type: 'number',
      minimum: 0,
      maximum: 8640000000000000,
      multipleOf: 1
    }
  },
  required: ['id', 'updatedTime'],
  indexes: [
    ['updatedTime', 'id'], // Required for replication
    ['nested.field1'], // Custom index
    ['arrayField'] // Array index
  ]
};
```

### Multiple Databases

```typescript
// Different databases for different data types
const userSync = createConvexSync({
  tableName: 'users',
  schema: userSchema,
  convexApi: api.users,
  databaseName: 'usersdb' // Separate database
});

const postsSync = createConvexSync({
  tableName: 'posts', 
  schema: postSchema,
  convexApi: api.posts,
  databaseName: 'postsdb' // Separate database
});
```

### Error Handling

```typescript
export function useYourTable() {
  const [syncInstance, setSyncInstance] = React.useState<any>(null);
  const [initError, setInitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    getYourSync()
      .then(setSyncInstance)
      .catch(error => {
        console.error('Sync initialization failed:', error);
        setInitError(String(error));
      });
  }, []);

  const syncResult = useConvexSync<YourItem>(syncInstance);

  return {
    ...syncResult,
    initError // Expose initialization errors separately
  };
}
```

## 🛠️ Development & Debugging

### Enable Detailed Logging

```typescript
const syncInstance = createConvexSync({
  // ... other config
  enableLogging: true // Detailed console logging
});
```

### Hot Reload Cleanup

```typescript
// Add to each hook file for development
if (typeof window !== 'undefined' && (import.meta as any).hot) {
  (import.meta as any).hot.dispose(() => {
    if (syncInstance) {
      syncInstance.then(({ database, replicationState }) => {
        replicationState?.cancel();
        database?.destroy();
      });
      syncInstance = null;
    }
  });
}
```

## 📋 Examples

See the following files for complete examples:
- `src/useTasks.ts` - Simple task management
- `src/useNotes.ts` - Complex notes with tags and search

## 🔄 Migration from Direct RxDB

If you're migrating from direct RxDB usage:

**Before:**
```typescript
// Complex direct RxDB setup
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

The new API handles all the complexity internally while providing the same functionality with better TypeScript support and easier testing.