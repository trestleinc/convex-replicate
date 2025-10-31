# @convex-replicate/component

Convex component for CRDT-based document storage and synchronization.

This component provides the CRDT storage layer for ConvexReplicate, handling conflict-free replication of Automerge documents. It acts as the source of truth for offline changes and automatic conflict resolution.

## Installation

```bash
npm install @convex-replicate/component
# or
bun add @convex-replicate/component
```

## Overview

The component provides:

1. **CRDT Storage** - Internal storage for Automerge document data
2. **ConvexReplicateStorage API** - Type-safe client API for interacting with the component
3. **Conflict Resolution** - Automatic merging of concurrent changes
4. **Change Tracking** - Incremental sync with checkpoints

## Setup

### 1. Install the Component

First, install the component in your Convex app configuration:

```typescript
// convex/convex.config.ts
import { defineApp } from 'convex/server';
import replicate from '@convex-replicate/component/convex.config';

const app = defineApp();
app.use(replicate, { name: 'replicate' });

export default app;
```

### 2. Create Storage Instance

Create a `ConvexReplicateStorage` instance for each collection:

```typescript
// convex/tasks.ts
import { components } from './_generated/api';
import { ConvexReplicateStorage } from '@convex-replicate/component';

const tasksStorage = new ConvexReplicateStorage(components.replicate, 'tasks');
```

### 3. Use in Mutations and Queries

Use the storage instance in your Convex functions:

```typescript
import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const updateTask = mutation({
  args: {
    id: v.string(),
    document: v.any(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    return await tasksStorage.submitDocument(
      ctx,
      args.id,
      args.document,
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
```

## API Reference

### `ConvexReplicateStorage<TDocument>`

Main class for interacting with the replicate component. Each instance is scoped to a specific collection.

#### Constructor

```typescript
new ConvexReplicateStorage<TDocument>(component, collectionName)
```

**Parameters:**
- `component` - The replicate component from `components.replicate`
- `collectionName` - Name of the collection to interact with

**Example:**
```typescript
import { components } from './_generated/api';
import { ConvexReplicateStorage } from '@convex-replicate/component';

interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

const tasksStorage = new ConvexReplicateStorage<Task>(
  components.replicate,
  'tasks'
);
```

#### Methods

##### `submitDocument(ctx, documentId, document, version)`

Submit a document to the component's CRDT storage.

**Parameters:**
- `ctx` - Convex mutation context
- `documentId` - Unique identifier for the document
- `document` - The document data to store
- `version` - Version number for conflict resolution

**Returns:** `Promise<{ success: boolean }>`

**Example:**
```typescript
export const updateTask = mutation({
  handler: async (ctx, { id, document, version }) => {
    return await tasksStorage.submitDocument(ctx, id, document, version);
  },
});
```

##### `pullChanges(ctx, checkpoint, limit?)`

Pull document changes from the component storage.

**Parameters:**
- `ctx` - Convex query context
- `checkpoint` - Object with `{ lastModified: number }`
- `limit` - Optional maximum number of changes to retrieve (default: 100)

**Returns:**
```typescript
Promise<{
  changes: Array<{
    documentId: string;
    document: TDocument;
    version: number;
    timestamp: number;
  }>;
  checkpoint: { lastModified: number };
  hasMore: boolean;
}>
```

**Example:**
```typescript
export const getTasks = query({
  handler: async (ctx, { checkpoint, limit }) => {
    return await tasksStorage.pullChanges(ctx, checkpoint, limit);
  },
});
```

##### `changeStream(ctx)`

Subscribe to collection changes via a reactive query.

**Parameters:**
- `ctx` - Convex query context

**Returns:** `Promise<{ timestamp: number; count: number }>`

**Example:**
```typescript
export const watchTasks = query({
  handler: async (ctx) => {
    const stream = await tasksStorage.changeStream(ctx);
    // When stream.timestamp or stream.count changes, query reruns
    return stream;
  },
});
```

##### `getDocumentMetadata(ctx, documentId)`

Retrieve metadata for a specific document.

**Parameters:**
- `ctx` - Convex query context
- `documentId` - Unique identifier for the document

**Returns:**
```typescript
Promise<{
  documentId: string;
  version: number;
  timestamp: number;
  document: TDocument;
} | null>
```

**Example:**
```typescript
export const getTaskMetadata = query({
  handler: async (ctx, { id }) => {
    return await tasksStorage.getDocumentMetadata(ctx, id);
  },
});
```

##### `for(documentId)`

Create a scoped API for a specific document ID.

**Parameters:**
- `documentId` - The document ID to scope methods to

**Returns:** Object with document-scoped methods:
- `submit(ctx, document, version)` - Submit this specific document
- `getMetadata(ctx)` - Get metadata for this specific document

**Example:**
```typescript
const task123 = tasksStorage.for('task-123');

export const updateTask123 = mutation({
  handler: async (ctx, { document, version }) => {
    return await task123.submit(ctx, document, version);
  },
});

export const getTask123Metadata = query({
  handler: async (ctx) => {
    return await task123.getMetadata(ctx);
  },
});
```

## Complete Example

Here's a complete example showing how to use the component in your Convex backend:

```typescript
// convex/tasks.ts
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { ConvexReplicateStorage } from '@convex-replicate/component';

interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

const tasksStorage = new ConvexReplicateStorage<Task>(
  components.replicate,
  'tasks'
);

export const submitTask = mutation({
  args: {
    id: v.string(),
    document: v.any(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    return await tasksStorage.submitDocument(
      ctx,
      args.id,
      args.document,
      args.version
    );
  },
});

export const pullChanges = query({
  args: {
    checkpoint: v.object({ lastModified: v.number() }),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await tasksStorage.pullChanges(ctx, args.checkpoint, args.limit);
  },
});

export const changeStream = query({
  handler: async (ctx) => {
    return await tasksStorage.changeStream(ctx);
  },
});

export const getTaskMetadata = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    return await tasksStorage.getDocumentMetadata(ctx, args.id);
  },
});
```

## Dual-Storage Pattern

This component is designed to work alongside main application tables in a dual-storage architecture:

### Component Storage (CRDT Layer)
- Stores Automerge CRDT data
- Handles conflict resolution automatically
- Source of truth for offline changes

### Main Application Tables
- Stores materialized documents
- Used for efficient queries and joins
- Optimized for reactive subscriptions

See [@convex-replicate/core](../core) for replication helpers that implement this pattern.

## Architecture

```
┌──────────────────────────────────────┐
│         Client Applications          │
│   (Offline-first with Automerge)     │
└────────────────┬─────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────┐
│      ConvexReplicateStorage API      │
│  (Type-safe, collection-scoped)      │
└────────────────┬─────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────┐
│       Replicate Component            │
│  ────────────────────────────        │
│  • submitDocument (mutation)         │
│  • pullChanges (query)               │
│  • changeStream (query)              │
│  • getDocumentMetadata (query)       │
└────────────────┬─────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────┐
│       Internal Storage Table         │
│  (documents with CRDT data)          │
│                                      │
│  Indexes:                            │
│  • by_collection_document            │
│  • by_collection                     │
│  • by_timestamp                      │
└──────────────────────────────────────┘
```

## Storage Schema

The component stores documents in an internal `documents` table with this structure:

```typescript
{
  collectionName: string;    // Collection identifier
  documentId: string;        // Document identifier
  document: any;             // CRDT document data
  version: number;           // Version for conflict detection
  timestamp: number;         // Last modification time
}
```

## TypeScript

This package is fully typed and exports complete type definitions.

## Related Packages

- [@convex-replicate/core](../core) - Replication helpers and SSR utilities
- Example app in `examples/tanstack-start/`

## License

MIT
