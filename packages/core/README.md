# @convex-replicate/core

Core utilities for building offline-first applications with Convex and Automerge CRDTs.

This package provides framework-agnostic replication helpers and SSR utilities for synchronizing data between clients and Convex backends. It implements a dual-storage architecture where documents are stored in both a CRDT component (for conflict resolution) and main application tables (for efficient querying).

## Installation

```bash
npm install @convex-replicate/core
# or
bun add @convex-replicate/core
```

## Overview

`@convex-replicate/core` provides three main categories of utilities:

1. **Replication Helpers** - Dual-storage write/read helpers for your Convex mutations and queries
2. **SSR Utilities** - Server-side data loading for initial page renders
3. **Configuration** - Automerge collection options and logging setup

## Dual-Storage Architecture

This package implements a dual-storage pattern where documents live in two places:

### 1. Component Storage (CRDT Layer)
- Stores Automerge CRDT data for offline-first conflict resolution
- Handles concurrent updates with automatic merging
- Source of truth for offline changes

### 2. Main Application Tables
- Stores materialized documents for efficient querying
- Used by server-side Convex functions for queries and joins
- Optimized for reactive subscriptions and complex queries

**Why both?**
- Component handles conflict resolution and offline sync
- Main table enables efficient server-side queries and subscriptions
- Similar to event sourcing: component = event log, main table = read model

## Replication Helpers

Use these helpers in your Convex mutations and queries to implement the dual-storage pattern.

### `submitDocumentHelper`

Submits a document to both the CRDT component and the main application table.

```typescript
import { submitDocumentHelper } from '@convex-replicate/core';
import { mutation } from './_generated/server';
import { components } from './_generated/api';

export const updateTask = mutation({
  args: { id: v.string(), document: v.any(), version: v.number() },
  handler: async (ctx, args) => {
    return await submitDocumentHelper(
      ctx,
      components,
      'tasks', // table name
      args
    );
  },
});
```

**Parameters:**
- `ctx` - Convex mutation context
- `components` - Generated components from `_generated/api`
- `tableName` - Name of the main application table
- `args` - Object with `{ id, document, version }`

**Returns:** `Promise<{ success: boolean }>`

### `pullChangesHelper`

Pulls document changes from the main application table for incremental synchronization.

```typescript
import { pullChangesHelper } from '@convex-replicate/core';
import { query } from './_generated/server';

export const pullTasks = query({
  args: {
    checkpoint: v.object({ lastModified: v.number() }),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await pullChangesHelper(ctx, 'tasks', args);
  },
});
```

**Parameters:**
- `ctx` - Convex query context
- `tableName` - Name of the main application table
- `args` - Object with `{ checkpoint: { lastModified }, limit? }`

**Returns:**
```typescript
Promise<{
  changes: Array<{
    documentId: string;
    document: unknown;
    version: number;
    timestamp: number;
  }>;
  checkpoint: { lastModified: number };
  hasMore: boolean;
}>
```

### `changeStreamHelper`

Returns the latest timestamp and count for detecting changes in a table.

```typescript
import { changeStreamHelper } from '@convex-replicate/core';
import { query } from './_generated/server';

export const watchTasks = query({
  handler: async (ctx) => {
    return await changeStreamHelper(ctx, 'tasks');
  },
});
```

**Parameters:**
- `ctx` - Convex query context
- `tableName` - Name of the main application table

**Returns:** `Promise<{ timestamp: number; count: number }>`

## SSR Utilities

Load collection data during server-side rendering for instant page loads.

### `loadCollection`

Loads initial data from Convex during SSR with an explicit configuration object.

```typescript
import { loadCollection } from '@convex-replicate/core/ssr';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

// In your server loader (TanStack Start, Remix, Next.js, etc.)
export async function loader() {
  const httpClient = new ConvexHttpClient(process.env.CONVEX_URL);

  const tasks = await loadCollection<Task>(httpClient, {
    api: api.tasks,
    collection: 'tasks',
    limit: 100,
  });

  return { tasks };
}
```

**Parameters:**
- `httpClient` - ConvexHttpClient instance for server-side queries
- `config` - Configuration object:
  - `api` - The API module for the collection (e.g., `api.tasks`)
  - `collection` - The collection name (should match the API module name)
  - `limit?` - Maximum number of items to load (default: 100)

**Returns:** `Promise<ReadonlyArray<TItem>>`

**Example with TanStack Start:**

```typescript
// app/routes/tasks.tsx
import { createFileRoute } from '@tanstack/react-router';
import { loadCollection } from '@convex-replicate/core/ssr';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

export const Route = createFileRoute('/tasks')({
  loader: async () => {
    const httpClient = new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL);
    
    const tasks = await loadCollection<Task>(httpClient, {
      api: api.tasks,
      collection: 'tasks',
      limit: 50,
    });

    return { initialTasks: tasks };
  },
});

function TasksPage() {
  const { initialTasks } = Route.useLoaderData();
  
  // Use initialTasks for instant rendering
  return <TaskList tasks={initialTasks} />;
}
```

## Configuration Utilities

### `convexAutomergeCollectionOptions`

Automerge collection options for TanStack DB integration.

```typescript
import { convexAutomergeCollectionOptions } from '@convex-replicate/core';
import { createDB } from '@tanstack/db';

const db = createDB({
  collections: {
    tasks: convexAutomergeCollectionOptions,
  },
});
```

### `configureLogger`

Configure the logger for debugging and development.

```typescript
import { configureLogger } from '@convex-replicate/core';

configureLogger({
  level: 'debug', // 'debug' | 'info' | 'warn' | 'error'
  enableConsole: true,
});
```

### `getConvexReplicateLogger`

Get a logger instance for custom logging.

```typescript
import { getConvexReplicateLogger } from '@convex-replicate/core';

const logger = getConvexReplicateLogger('my-module');

logger.info('Operation started', { userId: '123' });
logger.warn('Something unexpected', { reason: 'timeout' });
logger.error('Operation failed', { error });
```

## Complete Example

Here's a complete example showing how to use the replication helpers in your Convex backend:

```typescript
// convex/tasks.ts
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import {
  submitDocumentHelper,
  pullChangesHelper,
  changeStreamHelper,
} from '@convex-replicate/core';

export const updateTask = mutation({
  args: {
    id: v.string(),
    document: v.any(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    return await submitDocumentHelper(ctx, components, 'tasks', args);
  },
});

export const pullChanges = query({
  args: {
    checkpoint: v.object({ lastModified: v.number() }),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await pullChangesHelper(ctx, 'tasks', args);
  },
});

export const changeStream = query({
  handler: async (ctx) => {
    return await changeStreamHelper(ctx, 'tasks');
  },
});
```

## Schema Requirements

Your main application table must have these indexes:

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  tasks: defineTable({
    id: v.string(),
    text: v.string(),
    isCompleted: v.boolean(),
    version: v.number(),
    timestamp: v.number(),
    // ... other fields
  })
    .index('by_user_id', ['id'])
    .index('by_timestamp', ['timestamp']),
});
```

## TypeScript

This package is written in TypeScript and exports full type definitions.

## Related Packages

- [@convex-replicate/component](../component) - Convex component for CRDT storage
- Example app in `examples/tanstack-start/`

## License

MIT
