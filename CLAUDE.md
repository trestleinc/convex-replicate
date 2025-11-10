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
│   │   ├── storage.ts   # Replicate class (direct component access)
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

### 3. Use Replicate Wrapper Class

```typescript
// convex/tasks.ts
import { Replicate } from '@trestleinc/replicate/server';  // IMPORTANT: Use /server!
import { components } from './_generated/api';
import type { Task } from '../src/useTasks';

// Create storage instance for 'tasks' collection
const tasksStorage = new Replicate<Task>(components.replicate, 'tasks');

// Generate queries and mutations using factory methods
export const stream = tasksStorage.createStreamQuery();
export const getTasks = tasksStorage.createSSRQuery();
export const insertDocument = tasksStorage.createInsertMutation();
export const updateDocument = tasksStorage.createUpdateMutation();
export const deleteDocument = tasksStorage.createDeleteMutation();
export const getProtocolVersion = tasksStorage.createProtocolVersionQuery();

// Export compact and prune functions for cron jobs
export const compact = tasksStorage.createCompactMutation({ retentionDays: 90 });
export const prune = tasksStorage.createPruneMutation({ retentionDays: 180 });
```

**What `Replicate` provides:**

- `createStreamQuery()` - CRDT stream with gap detection support (for real-time sync)
- `createSSRQuery()` - Materialized docs query (for server-side rendering)
- `createInsertMutation()` - Dual-storage insert (component + main table)
- `createUpdateMutation()` - Dual-storage update (component + main table)
- `createDeleteMutation()` - Dual-storage delete (component + main table)
- `createProtocolVersionQuery()` - Protocol version wrapper (required for client)
- `createCompactMutation()` - Compaction function for cron jobs
- `createPruneMutation()` - Snapshot cleanup function for cron jobs

All factory methods support optional hooks for permissions and lifecycle events.

### 4. Client-Side Integration (TanStack DB)

**Note:** Protocol initialization happens automatically when you create your first collection - no manual setup required!

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
            getProtocolVersion: api.tasks.getProtocolVersion, // For protocol version checking
          },
          collection: 'tasks',
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

### 6. Set Up Automatic Compaction (Convex Cron Jobs)

ConvexReplicate uses **Convex's built-in cron system** to automatically clean up old CRDT deltas and maintain storage efficiency. Export compact and prune functions from your collection file, then schedule them using Convex's native `cronJobs()`.

**Step 1: Export compact and prune functions**

```typescript
// convex/tasks.ts
import { Replicate } from '@trestleinc/replicate/server';
import { components } from './_generated/api';
import type { Task } from '../src/useTasks';

// Create storage instance
const tasksStorage = new Replicate<Task>(components.replicate, 'tasks');

export const stream = tasksStorage.createStreamQuery();
export const getTasks = tasksStorage.createSSRQuery();
export const insertDocument = tasksStorage.createInsertMutation();
export const updateDocument = tasksStorage.createUpdateMutation();
export const deleteDocument = tasksStorage.createDeleteMutation();
export const getProtocolVersion = tasksStorage.createProtocolVersionQuery();

// Export compact and prune for cron jobs
export const compact = tasksStorage.createCompactMutation({ retentionDays: 90 });
export const prune = tasksStorage.createPruneMutation({ retentionDays: 180 });
```

**Step 2: Create cron schedule file**

```typescript
// convex/crons.ts
import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Daily compaction at 3am UTC
crons.daily(
  'compact tasks',
  { hourUTC: 3, minuteUTC: 0 },
  internal.tasks.compact
);

// Weekly snapshot cleanup on Sundays at 3am UTC
crons.weekly(
  'prune tasks snapshots',
  { dayOfWeek: 'sunday', hourUTC: 3, minuteUTC: 0 },
  internal.tasks.prune
);

export default crons;
```

**Per-collection customization:**

```typescript
// convex/tasks.ts - Frequent compaction, short retention
export const compact = tasksStorage.createCompactMutation({ retentionDays: 30 });
export const prune = tasksStorage.createPruneMutation({ retentionDays: 90 });

// convex/users.ts - Infrequent compaction, long retention
export const compact = usersStorage.createCompactMutation({ retentionDays: 365 });
export const prune = usersStorage.createPruneMutation({ retentionDays: 730 });
```

```typescript
// convex/crons.ts - Different schedules per collection
const crons = cronJobs();

// Tasks: Compact every 12 hours
crons.interval('compact tasks', { hours: 12 }, internal.tasks.compact);

// Users: Compact weekly
crons.weekly('compact users', { dayOfWeek: 'sunday', hourUTC: 3 }, internal.users.compact);

export default crons;
```

**How it works:**
- **Native Convex crons** - Uses Convex's built-in `cronJobs()` system (no external dependencies)
- **Server-side only** - Cron jobs run entirely on Convex servers
- **Per-collection control** - Each collection can have different retention policies and schedules
- **Standard pattern** - Follows the same pattern as any other Convex cron job
- **Full control** - Users define schedules using Convex's cron syntax (daily, weekly, interval, etc.)

## Key API Concepts

### Server-Side: Replicate Wrapper Class

**IMPORTANT**: Import from `@trestleinc/replicate/server` for server-safe imports!

The `Replicate<T>` class provides a type-safe wrapper for component operations. Instantiate once per collection:

```typescript
const storage = new Replicate<Task>(components.replicate, 'tasks');
```

**Factory Methods:**
- **`createStreamQuery(opts?)`** - CRDT stream with gap detection (for real-time sync)
- **`createSSRQuery(opts?)`** - Materialized docs query (for server-side rendering)
- **`createInsertMutation(opts?)`** - Dual-storage insert (component + main table)
- **`createUpdateMutation(opts?)`** - Dual-storage update (component + main table)
- **`createDeleteMutation(opts?)`** - Dual-storage delete (component + main table)

**Optional Hooks (all factory methods):**
- `checkRead` / `checkWrite` / `checkDelete` - Permission guards
- `onStream` / `onInsert` / `onUpdate` / `onDelete` - Lifecycle callbacks
- `transform` - Transform docs before returning (SSR query only)

### Client-Side Collection Options

- **`convexCollectionOptions<T>(config)`** - Create TanStack DB collection config with Yjs integration
- **`createConvexCollection<T>(rawCollection)`** - Wrap collection with offline support (TanStack offline-transactions)

### Schema Utilities

- **`replicatedTable(fields, applyIndexes?)`** - Automatically inject `version` and `timestamp` fields

## Component Storage Schema

The internal component uses an **event-sourced** schema:

```typescript
{
  collection: string;    // Collection identifier
  documentId: string;    // Document identifier
  crdtBytes: ArrayBuffer;    // Yjs CRDT delta (not full state!)
  version: number;           // Version for conflict detection
  timestamp: number;         // Last modification time
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
3. **Insert** - Client calls `collection.insert()` which triggers `insertDocument` mutation
4. **Dual-write** - Component appends delta to event log, main table stores current state
5. **Update** - Client merges changes offline, encodes delta
6. **Submit** - Client calls `collection.update()` which triggers `updateDocument` mutation
7. **Delete** - Client calls `collection.delete()` which triggers `deleteDocument` mutation (hard delete)
8. **Sync** - Yjs automatically merges concurrent changes (CRDT magic!)

### SSR Data Loading

```typescript
// TanStack Start loader
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

export const Route = createFileRoute('/tasks')({
  loader: async () => {
    const httpClient = new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL);
    const tasks = await httpClient.query(api.tasks.getTasks); // SSR query
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
