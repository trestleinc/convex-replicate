# @trestleinc/convex-replicate-component

**Convex component providing CRDT storage backend for offline-first applications.**

Part of [Convex Replicate](https://github.com/trestleinc/convex-replicate) - a dual-storage architecture for building offline-capable applications with Automerge CRDTs and automatic conflict resolution.

## What's Included

This package provides a plug-and-play Convex component that handles:

- **CRDT Storage** - Internal table for storing Automerge document bytes
- **`ReplicateStorage` API** - Type-safe client for interacting with the component
- **Public Functions**:
  - `insertDocument()` - Insert new documents with CRDT bytes
  - `updateDocument()` - Update existing documents with CRDT bytes
  - `deleteDocument()` - Delete documents
  - `pullChanges()` - Incremental sync with checkpoints
  - `changeStream()` - Real-time change detection

## Installation

```bash
# Install with core utilities
bun add @trestleinc/convex-replicate-component @trestleinc/convex-replicate-core convex

# Or with npm
npm install @trestleinc/convex-replicate-component @trestleinc/convex-replicate-core convex
```

## Quick Start

### Step 1: Install Component

Add the component to your Convex app:

```typescript
// convex/convex.config.ts
import { defineApp } from 'convex/server';
import replicate from '@trestleinc/convex-replicate-component/convex.config';

const app = defineApp();
app.use(replicate, { name: 'replicate' });

export default app;
```

### Step 2: Use Replication Helpers

**Recommended approach** - Use helpers from `@trestleinc/convex-replicate-core/replication`:

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
} from '@trestleinc/convex-replicate-core/replication';

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

### Step 3: Define Schema

Your main table must include these required fields:

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  tasks: defineTable({
    id: v.string(),              // Client-generated UUID
    version: v.number(),         // CRDT version
    timestamp: v.number(),       // Last modification time
    deleted: v.optional(v.boolean()), // Soft delete flag
    // Your application fields:
    text: v.string(),
    isCompleted: v.boolean(),
  })
    .index('by_user_id', ['id'])      // Required for lookups
    .index('by_timestamp', ['timestamp']), // Required for sync
});
```

## Advanced Usage: Direct API

For advanced use cases, use `ReplicateStorage` directly:

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

export const deleteTask = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    return await tasksStorage.deleteDocument(ctx, args.id);
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

## API Reference

### `ReplicateStorage<TDocument>`

Type-safe API for interacting with the replicate component.

**Constructor:**
```typescript
new ReplicateStorage<TDocument>(component, collectionName)
```

**Parameters:**
- `component` - Component reference from `components.replicate`
- `collectionName: string` - Name of the collection

**Methods:**

#### `insertDocument(ctx, documentId, crdtBytes, version)`

Insert a new document with CRDT bytes.

**Parameters:**
- `ctx` - Convex mutation context
- `documentId: string` - Unique document identifier
- `crdtBytes: ArrayBuffer` - Automerge CRDT bytes
- `version: number` - CRDT version number

**Returns:** `Promise<{ success: boolean }>`

**Example:**
```typescript
await tasksStorage.insertDocument(ctx, taskId, crdtBytes, 1);
```

#### `updateDocument(ctx, documentId, crdtBytes, version)`

Update an existing document with CRDT bytes.

**Parameters:**
- `ctx` - Convex mutation context
- `documentId: string` - Unique document identifier
- `crdtBytes: ArrayBuffer` - Updated Automerge CRDT bytes
- `version: number` - New CRDT version number

**Returns:** `Promise<{ success: boolean }>`

**Example:**
```typescript
await tasksStorage.updateDocument(ctx, taskId, newCrdtBytes, 2);
```

#### `deleteDocument(ctx, documentId)`

Delete a document.

**Parameters:**
- `ctx` - Convex mutation context
- `documentId: string` - Unique document identifier

**Returns:** `Promise<{ success: boolean }>`

**Example:**
```typescript
await tasksStorage.deleteDocument(ctx, taskId);
```

#### `pullChanges(ctx, checkpoint, limit?)`

Pull document changes for incremental sync.

**Parameters:**
- `ctx` - Convex query context
- `checkpoint: { lastModified: number }` - Last sync timestamp
- `limit?: number` - Max changes to return (default: 100)

**Returns:**
```typescript
Promise<{
  changes: Array<{
    documentId: string;
    crdtBytes: ArrayBuffer;
    version: number;
    timestamp: number;
  }>;
  checkpoint: { lastModified: number };
  hasMore: boolean;
}>
```

**Example:**
```typescript
const result = await tasksStorage.pullChanges(ctx, { lastModified: 0 }, 50);
console.log(`Pulled ${result.changes.length} changes`);
```

#### `changeStream(ctx)`

Subscribe to collection changes (reactive query).

**Parameters:**
- `ctx` - Convex query context

**Returns:** `Promise<{ timestamp: number; count: number }>`

**Example:**
```typescript
const { timestamp, count } = await tasksStorage.changeStream(ctx);
```

## Internal Storage Schema

The component manages an internal `documents` table:

```typescript
{
  collectionName: string;    // Collection identifier
  documentId: string;        // Document identifier
  crdtBytes: ArrayBuffer;    // Automerge CRDT bytes (opaque)
  version: number;           // Version for conflict detection
  timestamp: number;         // Last modification time
}
```

**Indexes:**
- `by_collection_document` - Lookup specific documents
- `by_collection` - Query all documents in a collection
- `by_timestamp` - Incremental sync support

## How It Works

### Dual-Storage Architecture

The component implements one half of the dual-storage pattern:

```
Client (Automerge CRDT)
  ↓
Component Storage (this package)
  - Stores CRDT bytes
  - Handles conflict resolution
  ↓
Main Application Tables (your schema)
  - Stores materialized documents
  - Enables efficient queries
```

**Why both?**
- **Component storage**: Source of truth for conflict resolution via CRDTs
- **Main tables**: Efficient queries, indexes, and reactive subscriptions

### Incremental Sync

Use checkpoints to efficiently sync only new changes:

```typescript
let checkpoint = { lastModified: 0 };

const result = await tasksStorage.pullChanges(ctx, checkpoint);
// Process result.changes...
checkpoint = result.checkpoint; // Update for next sync
```

## Component Configuration

The component is installed via `convex.config.ts`:

```typescript
// convex/convex.config.ts
import { defineApp } from 'convex/server';
import replicate from '@trestleinc/convex-replicate-component/convex.config';

const app = defineApp();

// Install with default name 'replicate'
app.use(replicate);

// Or with custom name
app.use(replicate, { name: 'myStorage' });

export default app;
```

Access via generated components:

```typescript
import { components } from './_generated/api';

const storage = new ReplicateStorage(components.replicate, 'tasks');
// or with custom name:
const storage = new ReplicateStorage(components.myStorage, 'tasks');
```

## Related Packages

- **[@trestleinc/convex-replicate-core](https://www.npmjs.com/package/@trestleinc/convex-replicate-core)** - Client-side utilities, TanStack DB integration, SSR support

## Documentation

- [Full Documentation](https://github.com/trestleinc/convex-replicate#readme)
- [Migration Guide v0.2.0](https://github.com/trestleinc/convex-replicate/blob/main/MIGRATION-0.2.0.md)
- [Example App](https://github.com/trestleinc/convex-replicate/tree/main/examples/tanstack-start)

## TypeScript Support

Full TypeScript support with:
- ESM and CommonJS builds
- Type definitions included
- Generic type parameter for document shape

```typescript
interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

const storage = new ReplicateStorage<Task>(components.replicate, 'tasks');
// Fully typed!
```

## License

Apache-2.0 - see [LICENSE](https://github.com/trestleinc/convex-replicate/blob/main/LICENSE)

Copyright 2025 Trestle Inc
