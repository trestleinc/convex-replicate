# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Always Use Context7 for Library Documentation

**CRITICAL**: When looking up documentation for any library (Yjs, Convex, TanStack, React, etc.), ALWAYS use the Context7 MCP tool (`mcp__context7__resolve-library-id` and `mcp__context7__get-library-docs`). NEVER use WebSearch for library documentation.

**Why:**
- Context7 provides accurate, up-to-date documentation with code examples
- WebSearch results can be outdated or incomplete
- Context7 has better code snippet coverage for technical libraries

**Usage pattern:**
1. First resolve the library ID: `mcp__context7__resolve-library-id` with library name
2. Then fetch docs: `mcp__context7__get-library-docs` with the resolved ID and topic

## Project Overview

**ConvexReplicate** - Offline-first data replication using Yjs CRDTs and Convex for automatic conflict resolution and real-time synchronization.

This package provides:
- A Convex component for CRDT storage
- Core replication utilities for building offline-first apps
- Integration with TanStack DB and offline-transactions for reactive state management and reliable sync

**Package Structure (Flattened):**
- `src/` - Package source code (at root level)
  - `client/` - Client-side utilities (ReplicateStorage, collection options)
  - `server/` - Server-side replication helpers (insertDocumentHelper, updateDocumentHelper, etc.)
  - `component/` - Convex component implementation
- `examples/tanstack-start/` - Example app using TanStack Start
- `examples/sveltekit/` - Example app using SvelteKit

## Available Scripts

### Build Commands
- `bun run build` - Build the entire package using Rslib (outputs to `dist/`)
- `bun run clean` - Remove dist/ directory

### Type Checking
- `bun run typecheck` - Type check the entire package

**Note:** Package uses Rslib (Rspack-based) for fast builds with module externalization. Outputs 4 entry points: client, server, ssr, and component.

### Example App Development

**IMPORTANT: Examples use pnpm for local development!**

Examples link to the root package using `"@trestleinc/replicate": "file:../.."`. This requires **pnpm** (not Bun) for proper symlink handling.

**Setup:**
```bash
# Install dependencies in an example
cd examples/tanstack-start  # or examples/sveltekit
pnpm install
```

**Running examples:**
- Within each example directory, run `pnpm run dev` (starts both app dev server + Convex)
- Or use individual commands:
  - `pnpm run dev:app` - Run only app dev server
  - `pnpm run dev:convex` - Run only Convex dev environment

### Code Quality (Biome v2)
- `bun run check` - Run lint + format checks (dry run, no changes)
- `bun run check:fix` - **Auto-fix all lint and format issues** (Run before committing)
- `bun run lint` - Lint all files (dry run)
- `bun run lint:fix` - Auto-fix lint issues only
- `bun run format` - Format all files
- `bun run format:check` - Check formatting without modifying

## Development Practices

### Before Committing
**ALWAYS run `bun run check:fix`** to ensure code quality. This will:
1. Fix all auto-fixable linting issues
2. Format all files according to Biome config
3. Report any remaining issues

### Dev Server Management
- **Do NOT run dev servers manually** - The development server is managed by another process
- If you need to start the example app, use `bun run dev:example` which handles both Vite and Convex

### Package Conventions
- **Flattened structure** - Root directory IS the package (@trestleinc/replicate)
- **Local development dependencies** use `file:../..` protocol in example package.json files
- **pnpm required for examples** - Proper symlink handling for `file:` protocol (Bun has issues)
- **Example apps** each have their own Convex backend in their respective directories
- **All examples share** the same Biome and TypeScript configuration from root
- **Rslib builds** output to `dist/` with 4 entry points (client, server, ssr, component)

### Biome Configuration Notes
- `noExplicitAny` is OFF in the linter config (line 23 of biome.json)
- `noConsole` warnings are enabled except in test files
- Generated files (`_generated/**`, `*.d.ts`, `routeTree.gen.ts`) are excluded from linting
- `sharded-counter` package is excluded from linting and formatting
- Config files allow disabling `useNodejsImportProtocol` rule

## Architecture: Dual-Storage Pattern

ConvexReplicate implements a dual-storage architecture for offline-first applications:

### Component Storage (CRDT Layer)
**Located in:** `packages/component/`
- Stores Yjs CRDT documents for conflict-free replication
- Handles automatic merging of concurrent offline changes
- Source of truth for conflict resolution
- Accessed via `ReplicateStorage` client API

### Main Application Tables
- Stores materialized/denormalized documents
- Used for efficient Convex queries, indexes, and reactive subscriptions
- Optimized for server-side operations and complex queries
- Similar to event sourcing: component = event log, main table = read model

### Why Both?
- **Component** provides automatic conflict resolution via CRDTs
- **Main tables** enable efficient server-side queries and subscriptions
- Separation allows offline-first client experience with powerful server capabilities

## Package Architecture

### @trestleinc/replicate (Root Package)

Single flattened package providing CRDT storage, replication utilities, and SSR support.

**Source Structure:**
- `src/client/` - Client-side utilities
  - `index.ts` - `ReplicateStorage` class, `convexCollectionOptions`, `createConvexCollection`
  - `collection.ts` - TanStack DB collection wrapper with Yjs + offline support
  - `convexCollectionOptions.ts` - TanStack DB collection options
  - `logger.ts` - LogTape logger configuration
- `src/server/` - Server-side replication helpers
  - `index.ts` - `insertDocumentHelper`, `updateDocumentHelper`, `deleteDocumentHelper`
  - `replication.ts` - Dual-storage write/read helpers for Convex functions
- `src/component/` - Convex component (deployed to Convex)
  - `schema.ts` - Internal `documents` table schema
  - `public.ts` - Component API functions
  - `convex.config.ts` - Component configuration

**Build Output (Rslib):**
- Built to `dist/` directory with 4 entry points:
  - `dist/index.js` - Client utilities (ReplicateStorage, collection options)
  - `dist/server.js` - Server-side helpers (insertDocumentHelper, etc.)
  - `dist/ssr.js` - SSR utilities (loadCollection)
  - `dist/component/` - Convex component files (5 files, 5.7 kB)

**Package Exports:**
- `@trestleinc/replicate/client` - Client-side utilities
- `@trestleinc/replicate/server` - Server-side helpers (safe for Convex functions)
- `@trestleinc/replicate/ssr` - SSR utilities
- `@trestleinc/replicate/convex.config` - Component configuration

**Build Configuration:**
- `rslib.config.ts` - Rslib configuration with 4 entry points
- Package size: ~20 kB total (Yjs is ~6KB vs Automerge ~150KB - 96% smaller!)

**IMPORTANT**: Server-side Convex code must import from `@trestleinc/replicate/server` for server-safe imports!

**Dependencies:**
- Requires `@tanstack/db` for collection options
- **Peer dependencies** (v0.3.0+): `yjs ^13.6.11`, `@tanstack/offline-transactions ^0.1.0`, `convex ^1.28.0`

**Component Storage Schema:**
```typescript
{
  collectionName: string;    // Collection identifier
  documentId: string;        // Document identifier
  crdtBytes: ArrayBuffer;    // Yjs CRDT bytes (opaque to server)
  version: number;           // Version for conflict detection
  timestamp: number;         // Last modification time
}
```

**Component Indexes:**
- `by_collection_document` - Lookup specific documents
- `by_collection` - Query all documents in a collection
- `by_timestamp` - Incremental sync support

## Technology Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Bun (for root package), pnpm (for examples with local dependencies)
- **Build Tools:** Rslib (Rspack-based, fast builds with externalization support)
- **Linting:** Biome v2
- **CRDTs:** Yjs with IndexedDB storage (via TanStack DB)
- **Backend:** Convex (cloud database and functions)
- **State Management:** TanStack DB for reactive collections
- **Logging:** LogTape
- **Testing:** TypeScript type checking

## Using ConvexReplicate in Your App

### 1. Install Component in Convex

```typescript
// convex/convex.config.ts
import { defineApp } from 'convex/server';
import replicate from '@trestleinc/replicate/convex.config';

const app = defineApp();
app.use(replicate, { name: 'replicate' });

export default app;
```

### 2. Create Storage Instance

```typescript
// convex/tasks.ts
import { components } from './_generated/api';
import { ReplicateStorage } from '@trestleinc/replicate/client';

const tasksStorage = new ReplicateStorage(components.replicate, 'tasks');
```

### 3. Use Replication Helpers

```typescript
// convex/tasks.ts (continued)
import {
  insertDocumentHelper,
  updateDocumentHelper,
  deleteDocumentHelper,
} from '@trestleinc/replicate/server';  // IMPORTANT: Use /server for server-safe imports!
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
    // Writes CRDT bytes to component AND materialized doc to main 'tasks' table
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
    // Also used for soft deletes (materializedDoc includes deleted: true)
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
    // Returns CRDT bytes from component (not main table)
    return await pullChangesHelper(ctx, components, 'tasks', {
      checkpoint: args.checkpoint,
      limit: args.limit,
    });
  },
});

export const changeStream = query({
  args: { collectionName: v.string() },
  handler: async (ctx) => {
    // Returns latest timestamp/count for change detection
    return await changeStreamHelper(ctx, components, 'tasks');
  },
});
```

### 4. Client-Side Integration (TanStack DB) - v0.3.0 Two-Step API

Create a custom hook that integrates TanStack DB with Convex Replicate using the new two-step API:

```typescript
// src/useTasks.ts
import { createCollection } from '@tanstack/react-db';
import {
  convexCollectionOptions,
  createConvexCollection,  // NEW in v0.3.0
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
let tasksCollection: ConvexCollection<Task>;

export function useTasks(initialData?: ReadonlyArray<Task>) {
  return useMemo(() => {
    if (!tasksCollection) {
      // Step 1: Create raw TanStack DB collection with ALL config
      const rawCollection = createCollection(
        convexCollectionOptions<Task>({
          convexClient,
          api: api.tasks,
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

Use in React components:

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

## Key API Concepts

### ReplicateStorage Methods

- **`insertDocument(ctx, documentId, crdtBytes, version)`** - Insert new document with CRDT bytes
- **`updateDocument(ctx, documentId, crdtBytes, version)`** - Update existing document with CRDT bytes (also used for soft deletes)
- **`pullChanges(ctx, checkpoint, limit?)`** - Pull CRDT bytes for incremental sync
- **`changeStream(ctx)`** - Subscribe to collection changes (reactive query)

### Replication Helpers (Server-Side)

**IMPORTANT**: Import from `@trestleinc/convex-replicate-core/replication` for server-safe imports!

- **`insertDocumentHelper(ctx, components, tableName, args)`** - Insert to both component (CRDT bytes) + main table (materialized doc)
- **`updateDocumentHelper(ctx, components, tableName, args)`** - Update both component + main table (also used for soft deletes)
- **`pullChangesHelper(ctx, components, tableName, args)`** - Read CRDT bytes from component with pagination
- **`changeStreamHelper(ctx, components, tableName)`** - Latest timestamp/count for change detection

### SSR Utilities

- **`loadCollection<T>(httpClient, config)`** - Load initial data during SSR
  - `config.api` - The API module (e.g., `api.tasks`)
  - `config.collection` - Collection name (must match API module name)
  - `config.limit` - Max items to load (default: 100)

## Required Convex Schema

Your main application tables must include these fields and indexes:

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  tasks: defineTable({
    id: v.string(),           // Document ID
    version: v.number(),      // Version for conflict detection
    timestamp: v.number(),    // Last modification timestamp
    // ... your application fields
  })
    .index('by_user_id', ['id'])
    .index('by_timestamp', ['timestamp']),
});
```

## Logging

ConvexReplicate uses LogTape for structured logging.

```typescript
import { configure, getConsoleSink } from '@logtape/logtape';
import { getLogger } from '@trestleinc/convex-replicate-core';

// Configure logging (in app entry point)
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

// Get logger instance
const logger = getLogger(['my-module']); // Accepts string or string array

logger.info('Operation started', { userId: '123' });
logger.warn('Something unexpected', { reason: 'timeout' });
logger.error('Operation failed', { error });
```

**Note:** Biome warns on `console.*` usage - use LogTape instead for consistency.

## Delete Pattern: Hard Delete with CRDT History (v0.3.0+)

**CRITICAL**: ConvexReplicate now uses hard deletes with full CRDT history preservation.

ConvexReplicate uses **hard deletes** where items are physically removed from the main table, while the CRDT component preserves complete event history for future recovery features.

### Why Hard Delete?

- Works with standard TanStack DB delete operations
- Clean main table (no filtering required)
- Complete audit trail preserved in component storage
- Proper CRDT conflict resolution maintained
- Multi-client sync works seamlessly
- Foundation for future recovery features

### Implementation

**Client-side delete handler:**
```typescript
const handleDelete = (id: string) => {
  // Hard delete - physically removes from main table
  collection.delete(id);
};
```

**UI usage:**
```typescript
// No filtering needed - deleted items are gone!
const { data: tasks } = useLiveQuery(collection);
```

**SSR loading:**
```typescript
export const Route = createFileRoute('/')({
  loader: async () => {
    // No filtering needed
    const tasks = await httpClient.query(api.tasks.stream);
    return { tasks };
  },
});
```

**Server-side stream endpoint:**
```typescript
// Returns only active items (deleted items physically removed)
export const stream = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect();
  },
});
```

### Architecture

The deletion flow:
1. Client calls `collection.delete(id)` (TanStack DB operation)
2. `onDelete` handler captures Yjs deletion delta
3. Delta sent to Convex component (appended to event log)
4. Main table: document physically deleted
5. Subscription detects removal and propagates to other clients
6. CRDT history preserved in component storage for future recovery

### Dual Storage

**Component Storage (CRDT Layer):**
- Append-only event log with all deltas
- Preserves complete history including deletions
- Enables future recovery features
- Source of truth for conflict resolution

**Main Application Table:**
- Current state only (hard deletes)
- Efficient queries and indexes
- No deleted items (clean data)

This ensures:
- Client A deletes item → Convex removes → Broadcasts to all clients
- Client B receives deletion → Item removed from local state
- Multi-client CRDT sync works perfectly
- Complete audit trail available via component storage

## Example App

The `examples/tanstack-start/` directory contains a complete working example:

**Key Files:**
- `convex/convex.config.ts` - Component installation
- `convex/tasks.ts` - Convex functions using replication helpers
- `convex/schema.ts` - Application schema with required indexes
- `src/` - React components using TanStack Start
- `vite.config.ts` - Vite configuration with Wasm/top-level-await plugins

**Running:**
```bash
cd examples/tanstack-start
bun run dev  # Starts both Vite and Convex dev servers
```

## Common Patterns

### Document Lifecycle

1. **Create** - Client generates Yjs document with unique ID
2. **Save as bytes** - Client calls `Y.encodeStateAsUpdate()` to get CRDT bytes
3. **Insert** - Call `insertDocumentHelper` with both CRDT bytes + materialized doc
4. **Dual-write** - Component stores CRDT bytes, main table stores materialized doc
5. **Update** - Client merges changes offline using Yjs updates, saves as bytes
6. **Submit update** - Call `updateDocumentHelper` with new CRDT bytes + materialized doc
7. **Delete** - Client calls `collection.update()` to set `deleted: true` (soft delete, works like `isCompleted`)
8. **Conflict** - Yjs automatically merges concurrent changes on client (CRDT magic)

### Incremental Sync

Use checkpoints to efficiently sync only new/changed documents:

```typescript
// Client tracks last checkpoint
let checkpoint = { lastModified: 0 };

// Pull changes since checkpoint
const result = await convex.query(api.tasks.pullChanges, {
  checkpoint,
  limit: 100,
});

// Process changes - merge CRDT bytes
for (const change of result.changes) {
  await store.merge(change.documentId, change.crdtBytes);
}

// Update checkpoint for next sync
checkpoint = result.checkpoint;
```

### SSR Data Loading

Load initial data on server for instant rendering:

```typescript
// TanStack Start loader
import { loadCollection } from '@trestleinc/convex-replicate-core/ssr';
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
```

## Troubleshooting

### Build Issues
- Ensure component builds before core: `bun run build:component && bun run build:core`
- Clear dist folders if stale: `bun run clean`
- Component requires both ESM and CommonJS builds
- Core package uses Rslib - if build fails, check `packages/core/rslib.config.ts`

### Missing Peer Dependencies (v0.3.0+)
- **Error**: `Cannot find module 'yjs'` or `Cannot find module '@tanstack/offline-transactions'`
- **Cause**: Only affects npm/yarn/pnpm users (Bun installs peer dependencies automatically)
- **Solution**: Install peer dependencies manually:
  ```bash
  # npm
  npm install yjs @tanstack/offline-transactions
  
  # yarn/pnpm
  yarn/pnpm add yjs @tanstack/offline-transactions
  ```
- See [MIGRATION-0.3.0.md](./MIGRATION-0.3.0.md) for details

### Type Errors
- Run `bun run typecheck` to check all packages
- Ensure peer dependencies are installed (Yjs, TanStack offline-transactions, Convex ^1.28.0)
- Check that Convex codegen is up to date: `convex dev` in example

### Linting/Formatting
- Run `bun run check:fix` before committing
- Note: `noExplicitAny` is disabled, but still prefer typed code
- Generated files are auto-excluded from linting

## Important Notes

- **Don't run dev servers** - They're managed by another process
- **Build order matters** - Component before Core
- **Dual-storage is required** - Both component and main tables needed
- **Yjs is peer dependency** - Must be installed by users (v0.3.0+)
- **Yjs is the CRDT engine** - Replaced Automerge in v0.3.0 (96% smaller, no WASM)
- **TanStack offline-transactions** - Handles outbox pattern and retry logic (v0.3.0+)
- **Two-step collection creation** - `convexCollectionOptions` then `createConvexCollection` (v0.3.0+)
- **Core uses Rslib** - Fast Rspack-based bundler with externalization
- **Component uses tsc** - TypeScript compiler (Convex needs source files)
- **LogTape for logging** - Not console.* (Biome warns on console usage)
- **Context7 for docs** - Always use for library documentation lookups
