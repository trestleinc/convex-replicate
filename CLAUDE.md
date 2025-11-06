# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Always Use Context7 for Library Documentation

**CRITICAL**: When looking up documentation for any library (Yjs, Convex, TanStack, React, etc.), ALWAYS use the Context7 MCP tool. NEVER use WebSearch for library documentation.

**Why:**
- Context7 provides accurate, up-to-date documentation with code examples
- WebSearch results can be outdated or incomplete
- Context7 has better code snippet coverage for technical libraries

**Usage pattern:**
1. First resolve the library ID: `mcp__context7__resolve-library-id` with library name
2. Then fetch docs: `mcp__context7__get-library-docs` with the resolved ID and topic

## Project Overview

**ConvexReplicate** (`@trestleinc/replicate`) - Offline-first data replication using Yjs CRDTs and Convex for automatic conflict resolution and real-time synchronization.

This is a **single package** that provides:
- Client-side utilities for browser/React/Svelte apps
- Server-side replication helpers for Convex functions
- SSR utilities for data preloading
- Internal Convex component for CRDT storage (event-sourced architecture)

## Package Structure

**IMPORTANT:** This is a FLATTENED single-package architecture:

```
@trestleinc/replicate/
├── src/
│   ├── client/          # Client-side utilities (browser/React/Svelte)
│   │   ├── index.ts     # Main exports (convexCollectionOptions, createConvexCollection)
│   │   ├── collection.ts # TanStack DB + Yjs integration
│   │   ├── storage.ts   # ReplicateStorage class (direct component access)
│   │   └── logger.ts    # LogTape logger
│   ├── server/          # Server-side utilities (Convex functions)
│   │   ├── index.ts     # Main exports (replication helpers, schema utilities)
│   │   ├── replication.ts # Dual-storage helpers
│   │   ├── schema.ts    # replicatedTable() helper
│   │   └── ssr.ts       # SSR data loading (loadCollection)
│   └── component/       # Internal Convex component (event-sourced CRDT storage)
│       ├── convex.config.ts # Component configuration
│       ├── schema.ts    # Event log schema
│       └── public.ts    # Component API (insertDocument, updateDocument, etc.)
├── examples/
│   ├── tanstack-start/  # TanStack Start example
│   └── sveltekit/       # SvelteKit example
├── dist/                # Build output (rslib)
│   ├── index.js         # Client bundle
│   ├── server.js        # Server bundle
│   ├── ssr.js           # SSR bundle
│   └── component/       # Component files (bundleless)
└── package.json         # @trestleinc/replicate
```

**Package Exports:**
- `@trestleinc/replicate/client` → Client utilities
- `@trestleinc/replicate/server` → Server helpers (MUST use for Convex functions!)
- `@trestleinc/replicate/ssr` → SSR utilities
- `@trestleinc/replicate/convex.config` → Component configuration

## Architecture: Event-Sourced CRDT Storage

### Core Concept: Append-Only Event Log

ConvexReplicate implements an **event sourcing** architecture:

**Component Storage** (`src/component/`):
- Append-only event log of Yjs CRDT deltas
- Each mutation appends a new entry (never updates existing ones)
- Schema includes `operationType: 'insert' | 'update' | 'delete'`
- Preserves complete history for debugging and future recovery
- Source of truth for conflict resolution

**Main Application Tables:**
- Stores current state (materialized documents)
- Used for efficient Convex queries, indexes, subscriptions
- Optimized for server-side operations

**Why Both?**
- **Component = Event Log**: Complete history, CRDT conflict resolution
- **Main Table = Read Model**: Current state, efficient queries
- Similar to CQRS: write to event log, read from materialized view

### Data Flow

```
Client (Yjs) → TanStack DB → Offline Executor
    ↓
insertDocument/updateDocument/deleteDocument mutation
    ↓
Component: APPEND delta to event log (never update)
    ↓
Main Table: INSERT/UPDATE/DELETE materialized doc
    ↓
Subscription notifies other clients
```

### Delete Pattern: Hard Delete with Event History

**v0.3.0+** uses hard deletes:
- Main table: Document physically removed
- Component: Deletion delta appended to event log (history preserved)
- No filtering required in queries
- Standard TanStack DB `collection.delete()` operations

## Available Scripts

### Build Commands
- `pnpm run build` - Build entire package using Rslib (outputs to `dist/`)
- `pnpm run clean` - Remove dist/ directory
- `pnpm run typecheck` - Type check entire package

### Example App Development

**IMPORTANT: Examples use pnpm!**

Examples link to root package using `"@trestleinc/replicate": "file:../.."`. This requires **pnpm** (not Bun) for proper symlink handling.

**Setup:**
```bash
cd examples/tanstack-start  # or examples/sveltekit
pnpm install
```

**Running examples:**
```bash
pnpm run dev          # Starts both app dev server + Convex
pnpm run dev:app      # Run only app dev server
pnpm run dev:convex   # Run only Convex dev environment
```

### Code Quality (Biome v2)
- `pnpm run check` - Run lint + format checks (dry run)
- `pnpm run check:fix` - **Auto-fix all lint and format issues** (Run before committing!)
- `pnpm run lint` - Lint all files (dry run)
- `pnpm run lint:fix` - Auto-fix lint issues only
- `pnpm run format` - Format all files
- `pnpm run format:check` - Check formatting

## Development Practices

### Before Committing
**ALWAYS run `pnpm run check:fix`** to ensure code quality.

### Package Conventions
- **Single flattened package** - Root IS the package (`@trestleinc/replicate`)
- **pnpm required for examples** - Proper symlink handling for `file:` protocol
- **Example apps** have their own Convex backends in respective directories
- **Rslib builds** output to `dist/` with 4 entry points (client, server, ssr, component)

### Biome Configuration Notes
- `noExplicitAny` is OFF (line 23 of biome.json)
- `noConsole` warnings enabled except in test files
- Generated files (`_generated/**`, `*.d.ts`) excluded from linting

## Technology Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js with pnpm package manager
- **Build Tools:** Rslib (Rspack-based, fast builds with externalization)
- **Linting:** Biome v2
- **CRDTs:** Yjs with IndexedDB storage (via TanStack DB)
- **Backend:** Convex (cloud database and functions)
- **State Management:** TanStack DB for reactive collections
- **Offline Sync:** TanStack offline-transactions (outbox pattern)
- **Logging:** LogTape

## Using ConvexReplicate in Your App

### 1. Install Component in Convex

```typescript
// convex/convex.config.ts
import { defineApp } from 'convex/server';
import replicate from '@trestleinc/replicate/convex.config';

const app = defineApp();
app.use(replicate);

export default app;
```

### 2. Define Schema with replicatedTable Helper

```typescript
// convex/schema.ts
import { defineSchema } from 'convex/server';
import { v } from 'convex/values';
import { replicatedTable } from '@trestleinc/replicate/server';

export default defineSchema({
  tasks: replicatedTable(
    {
      // User-defined business fields only
      // version and timestamp auto-injected by replicatedTable
      id: v.string(),
      text: v.string(),
      isCompleted: v.boolean(),
    },
    (table) => table
      .index('by_user_id', ['id'])
      .index('by_timestamp', ['timestamp'])
  ),
});
```

**What `replicatedTable` does:**
- Automatically injects `version: v.number()` and `timestamp: v.number()`
- Users only define business logic fields
- Enables dual-storage architecture

### 3. Use Replication Helpers

```typescript
// convex/tasks.ts
import { components } from './_generated/api';
import {
  insertDocumentHelper,
  updateDocumentHelper,
  deleteDocumentHelper,
} from '@trestleinc/replicate/server';  // IMPORTANT: Use /server!
import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const insertDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    materializedDoc: v.any(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    // Writes CRDT delta to component AND materialized doc to main table
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
    crdtBytes: v.bytes(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    // Hard delete from main table, append delta to component
    return await deleteDocumentHelper(ctx, components, 'tasks', {
      id: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
    });
  },
});

/**
 * Stream endpoint for real-time subscriptions
 * Returns active items only (hard deletes physically removed)
 */
export const stream = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect();
  },
});
```

### 4. Client-Side Integration (TanStack DB)

```typescript
// src/useTasks.ts
import { createCollection } from '@tanstack/react-db';
import {
  convexCollectionOptions,
  createConvexCollection,
  type ConvexCollection,
} from '@trestleinc/replicate/client';
import { api } from '../convex/_generated/api';
import { convexClient } from './router';
import { useMemo } from 'react';

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

// Module-level singleton
let tasksCollection: ConvexCollection<Task>;

export function useTasks(initialData?: ReadonlyArray<Task>) {
  return useMemo(() => {
    if (!tasksCollection) {
      // Step 1: Create raw collection with ALL config
      const rawCollection = createCollection(
        convexCollectionOptions<Task>({
          convexClient,
          api: {
            stream: api.tasks.stream,
            insertDocument: api.tasks.insertDocument,
            updateDocument: api.tasks.updateDocument,
            deleteDocument: api.tasks.deleteDocument,
          },
          collectionName: 'tasks',
          getKey: (task) => task.id,
          initialData,
        })
      );

      // Step 2: Wrap with offline support (Yjs + TanStack)
      tasksCollection = createConvexCollection(rawCollection);
    }
    return tasksCollection;
  }, [initialData]);
}
```

### 5. Use in React Components

```typescript
// src/routes/index.tsx
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

  const handleDelete = (id: string) => {
    // Hard delete - physically removes from main table
    collection.delete(id);
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
          <button onClick={() => handleDelete(task.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
```

## Key API Concepts

### Server-Side Replication Helpers

**IMPORTANT**: Import from `@trestleinc/replicate/server` for server-safe imports!

- **`insertDocumentHelper(ctx, components, tableName, args)`** - Insert to both component (CRDT delta) + main table (materialized doc)
- **`updateDocumentHelper(ctx, components, tableName, args)`** - Update both component + main table
- **`deleteDocumentHelper(ctx, components, tableName, args)`** - Hard delete from main table, append delta to component
- **`streamHelper(ctx, components, tableName, args)`** - Read CRDT deltas from component with pagination

### Client-Side Collection Options

- **`convexCollectionOptions<T>(config)`** - Create TanStack DB collection config with Yjs integration
- **`createConvexCollection<T>(rawCollection)`** - Wrap collection with offline support (TanStack offline-transactions)

### SSR Utilities

- **`loadCollection<T>(httpClient, config)`** - Load initial data during SSR (deprecated, use custom query instead)

### Schema Utilities

- **`replicatedTable(fields, applyIndexes?)`** - Automatically inject `version` and `timestamp` fields

### ReplicateStorage (Advanced)

Direct component access for advanced use cases:

- **`ReplicateStorage<T>(component, collectionName)`** - Type-safe API for component
- **`insertDocument(ctx, documentId, crdtBytes, version)`** - Insert CRDT delta
- **`updateDocument(ctx, documentId, crdtBytes, version)`** - Update CRDT delta
- **`deleteDocument(ctx, documentId, crdtBytes, version)`** - Delete CRDT delta
- **`stream(ctx, checkpoint, limit?)`** - Stream CRDT deltas

## Component Storage Schema

The internal component uses an **event-sourced** schema:

```typescript
{
  collectionName: string;    // Collection identifier
  documentId: string;        // Document identifier
  crdtBytes: ArrayBuffer;    // Yjs CRDT delta (not full state!)
  version: number;           // Version for conflict detection
  timestamp: number;         // Last modification time
  operationType: string;     // 'insert' | 'update' | 'delete'
}
```

**Key indexes:**
- `by_collection` - Query all deltas for collection
- `by_collection_document_version` - Query document history
- `by_timestamp` - Incremental sync support

## Logging

ConvexReplicate uses LogTape for structured logging:

```typescript
import { configure, getConsoleSink } from '@logtape/logtape';
import { getLogger } from '@trestleinc/replicate/client';

// Configure (in app entry point)
await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    {
      category: ['convex-replicate'],
      lowestLevel: 'debug', // 'debug' | 'info' | 'warn' | 'error'
      sinks: ['console']
    }
  ],
});

// Get logger
const logger = getLogger(['my-module']);
logger.info('Operation started', { userId: '123' });
```

**Note:** Biome warns on `console.*` usage - use LogTape instead.

## Example App

`examples/tanstack-start/` contains a complete working example:

**Key Files:**
- `convex/convex.config.ts` - Component installation
- `convex/schema.ts` - Application schema with `replicatedTable`
- `convex/tasks.ts` - Convex functions using replication helpers
- `src/useTasks.ts` - Custom hook with TanStack DB integration
- `src/routes/index.tsx` - React components

**Running:**
```bash
cd examples/tanstack-start
pnpm install
pnpm run dev  # Starts both Vite and Convex
```

## Common Patterns

### Document Lifecycle

1. **Create** - Client generates Yjs document with unique ID
2. **Encode** - Client calls `Y.encodeStateAsUpdate()` to get CRDT delta
3. **Insert** - Call `insertDocumentHelper` with both CRDT delta + materialized doc
4. **Dual-write** - Component appends delta to event log, main table stores current state
5. **Update** - Client merges changes offline, encodes delta
6. **Submit** - Call `updateDocumentHelper` with new CRDT delta + materialized doc
7. **Delete** - Client calls `collection.delete()` (hard delete)
8. **Sync** - Yjs automatically merges concurrent changes (CRDT magic!)

### SSR Data Loading

```typescript
// TanStack Start loader
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

export const Route = createFileRoute('/tasks')({
  loader: async () => {
    const httpClient = new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL);
    const tasks = await httpClient.query(api.tasks.stream);
    return { initialTasks: tasks };
  },
});

// In component
function TasksPage() {
  const { initialTasks } = Route.useLoaderData();
  const collection = useTasks(initialTasks); // Pass to hook
  // ...
}
```

## Troubleshooting

### Build Issues
- Clear dist if stale: `pnpm run clean`
- Check rslib.config.ts if build fails
- Component requires bundleless mode (preserves directory structure)

### Type Errors
- Run `pnpm run typecheck` to check all packages
- Ensure peer dependencies installed (convex ^1.28.0, @tanstack/db ^0.4.20)
- Check Convex codegen: `convex dev`

### Linting/Formatting
- Run `pnpm run check:fix` before committing
- `noExplicitAny` disabled but prefer typed code

## Important Notes

- **Single package architecture** - Not separate packages!
- **Event-sourced component** - Append-only event log, not state replacement
- **Dual-storage required** - Both component and main tables needed
- **Peer dependencies** - convex and @tanstack/db (auto-installed by pnpm/npm v7+/Bun)
- **Hard deletes** - Physically removed from main table, history in component
- **replicatedTable helper** - Auto-injects version and timestamp fields
- **Rslib for build** - Fast Rspack-based bundler with externalization
- **LogTape for logging** - Not console.* (Biome warns on console usage)
- **Context7 for docs** - Always use for library documentation lookups
