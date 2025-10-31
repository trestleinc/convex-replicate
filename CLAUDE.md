# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Always Use Context7 for Library Documentation

**CRITICAL**: When looking up documentation for any library (Automerge, Convex, TanStack, React, etc.), ALWAYS use the Context7 MCP tool (`mcp__context7__resolve-library-id` and `mcp__context7__get-library-docs`). NEVER use WebSearch for library documentation.

**Why:**
- Context7 provides accurate, up-to-date documentation with code examples
- WebSearch results can be outdated or incomplete
- Context7 has better code snippet coverage for technical libraries

**Usage pattern:**
1. First resolve the library ID: `mcp__context7__resolve-library-id` with library name
2. Then fetch docs: `mcp__context7__get-library-docs` with the resolved ID and topic

## Project Overview

**ConvexReplicate** - Offline-first data replication using Automerge CRDTs and Convex for automatic conflict resolution and real-time synchronization.

This is a monorepo providing:
- A Convex component for CRDT storage
- Core replication utilities for building offline-first apps
- Integration with TanStack DB for reactive state management

**Monorepo Structure:**
- `packages/component/` - Convex component for CRDT storage (@convex-replicate/component)
- `packages/core/` - Framework-agnostic replication helpers and SSR utilities (@convex-replicate/core)
- `packages/sharded-counter/` - Sharded counter example/component (experimental)
- `examples/tanstack-start/` - Example app using TanStack Start

## Available Scripts

### Build Commands
- `bun run build` - Build all packages (component → core in sequence)
- `bun run build:component` - Build only @convex-replicate/component package
- `bun run build:core` - Build only @convex-replicate/core package
- `bun run clean` - Remove all dist/ directories from packages

### Type Checking
- `bun run typecheck` - Type check all packages
- `bun run typecheck:component` - Type check only @convex-replicate/component
- `bun run typecheck:core` - Type check only @convex-replicate/core (uses tsc --noEmit)

**Note:** Component package uses both ESM and CommonJS builds, while core uses TypeScript compilation.

### Example App Development
- `bun run dev:example` - Start TanStack Start dev server + Convex dev environment (runs both concurrently)
- `bun run build:example` - Build example app for production

**Important:** Within `examples/tanstack-start/`, you can also run:
- `bun run dev:app` - Run only Vite dev server
- `bun run dev:convex` - Run only Convex dev environment

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

### Monorepo Conventions
- **Workspace dependencies** use `workspace:*` protocol in package.json
- **All packages share** the same Biome and TypeScript configuration from root
- **Type checking** runs against all packages
- **Example apps** each have their own Convex backend in their respective directories
- **Build order matters**: Component must build before Core (handled by build script)
- **Component package** has dual build (ESM + CommonJS) for broad compatibility

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
- Stores Automerge CRDT documents for conflict-free replication
- Handles automatic merging of concurrent offline changes
- Source of truth for conflict resolution
- Accessed via `ConvexReplicateStorage` client API

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

### @convex-replicate/component (`packages/component/`)

Convex component providing CRDT storage layer.

**Key Files:**
- `src/component/` - Component implementation (deployed to Convex)
  - `schema.ts` - Internal `documents` table schema
  - `public.ts` - Public API functions (submitDocument, pullChanges, changeStream, getDocumentMetadata)
  - `convex.config.ts` - Component configuration
- `src/client/` - Type-safe client API
  - `index.ts` - `ConvexReplicateStorage` class for interacting with component

**Build Output:**
- Dual package (ESM + CommonJS) in `dist/esm/` and `dist/commonjs/`
- Uses TypeScript compilation with separate tsconfig files (`esm.json`, `commonjs.json`)

**Storage Schema:**
```typescript
{
  collectionName: string;    // Collection identifier
  documentId: string;        // Document identifier
  document: any;             // Automerge CRDT data
  version: number;           // Version for conflict detection
  timestamp: number;         // Last modification time
}
```

**Indexes:**
- `by_collection_document` - Lookup specific documents
- `by_collection` - Query all documents in a collection
- `by_timestamp` - Incremental sync support

### @convex-replicate/core (`packages/core/`)

Framework-agnostic utilities for replication and SSR.

**Key Files:**
- `src/index.ts` - Main exports (replication helpers, storage, logger, collection options)
- `src/replication.ts` - Dual-storage write/read helpers:
  - `submitDocumentHelper()` - Write to both component and main table
  - `pullChangesHelper()` - Read from main table for incremental sync
  - `changeStreamHelper()` - Detect changes for reactive queries
- `src/ssr.ts` - `loadCollection()` for server-side data loading
- `src/store.ts` - `AutomergeDocumentStore` for managing Automerge documents
- `src/adapter.ts` - `SyncAdapter` for abstracting storage backends
- `src/convexAutomergeCollectionOptions.ts` - TanStack DB collection options
- `src/logger.ts` - LogTape logger configuration

**Build Output:**
- TypeScript compilation to `dist/` directory
- Exports: `.` (main), `./replication`, `./ssr`

**Dependencies:**
- Requires `@tanstack/db` for collection options
- Peer dependency on `convex ^1.28.0`

## Technology Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Bun
- **Build:** TypeScript compiler (both packages)
- **Linting:** Biome v2
- **CRDTs:** Automerge 3.x with IndexedDB storage
- **Backend:** Convex (cloud database and functions)
- **State Management:** TanStack DB for reactive collections
- **Logging:** LogTape
- **Testing:** Vitest (component package), TypeScript type checking

## Using ConvexReplicate in Your App

### 1. Install Component in Convex

```typescript
// convex/convex.config.ts
import { defineApp } from 'convex/server';
import replicate from '@convex-replicate/component/convex.config';

const app = defineApp();
app.use(replicate, { name: 'replicate' });

export default app;
```

### 2. Create Storage Instance

```typescript
// convex/tasks.ts
import { components } from './_generated/api';
import { ConvexReplicateStorage } from '@convex-replicate/component';

const tasksStorage = new ConvexReplicateStorage(components.replicate, 'tasks');
```

### 3. Use Replication Helpers

```typescript
// convex/tasks.ts (continued)
import { submitDocumentHelper, pullChangesHelper, changeStreamHelper } from '@convex-replicate/core';
import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const updateTask = mutation({
  args: { id: v.string(), document: v.any(), version: v.number() },
  handler: async (ctx, args) => {
    // Writes to both component storage AND main 'tasks' table
    return await submitDocumentHelper(ctx, components, 'tasks', args);
  },
});

export const pullChanges = query({
  args: {
    checkpoint: v.object({ lastModified: v.number() }),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Reads from main 'tasks' table for efficient queries
    return await pullChangesHelper(ctx, 'tasks', args);
  },
});

export const changeStream = query({
  handler: async (ctx) => {
    // Returns latest timestamp/count for change detection
    return await changeStreamHelper(ctx, 'tasks');
  },
});
```

### 4. Client-Side Integration (TanStack DB)

```typescript
import { AutomergeDocumentStore } from '@convex-replicate/core';
import { SyncAdapter } from '@convex-replicate/core';
import { convexAutomergeCollectionOptions } from '@convex-replicate/core';
import { createDB } from '@tanstack/db';

// Create Automerge store with IndexedDB persistence
const store = new AutomergeDocumentStore({ collectionName: 'tasks' });

// Create sync adapter for Convex replication
const adapter = new SyncAdapter({
  store,
  convexClient,
  api: api.tasks,
});

// Create reactive database
const db = createDB({
  collections: {
    tasks: convexAutomergeCollectionOptions,
  },
});

// Start syncing
await adapter.sync();
```

## Key API Concepts

### ConvexReplicateStorage Methods

- **`submitDocument(ctx, documentId, document, version)`** - Submit document to component storage
- **`pullChanges(ctx, checkpoint, limit?)`** - Pull incremental changes from component
- **`changeStream(ctx)`** - Subscribe to collection changes (reactive query)
- **`getDocumentMetadata(ctx, documentId)`** - Get document version and timestamp
- **`for(documentId)`** - Create document-scoped API

### Replication Helpers

- **`submitDocumentHelper(ctx, components, tableName, args)`** - Dual-write to component + main table
- **`pullChangesHelper(ctx, tableName, args)`** - Read from main table with pagination
- **`changeStreamHelper(ctx, tableName)`** - Latest timestamp/count for change detection

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
import { configureLogger, getConvexReplicateLogger } from '@convex-replicate/core';

// Configure logging
configureLogger({
  level: 'debug', // 'debug' | 'info' | 'warn' | 'error'
  enableConsole: true,
});

// Get logger instance
const logger = getConvexReplicateLogger('my-module');

logger.info('Operation started', { userId: '123' });
logger.warn('Something unexpected', { reason: 'timeout' });
logger.error('Operation failed', { error });
```

**Note:** Biome warns on `console.*` usage - use LogTape instead for consistency.

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

1. **Create** - Client generates Automerge document with unique ID
2. **Submit** - Call `submitDocumentHelper` to write to component + main table
3. **Sync** - Component stores CRDT data, main table gets materialized version
4. **Update** - Client merges changes offline, submits new version on reconnect
5. **Conflict** - Automerge automatically merges concurrent changes (CRDT magic)

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

// Process changes
for (const change of result.changes) {
  await store.merge(change.documentId, change.document);
}

// Update checkpoint for next sync
checkpoint = result.checkpoint;
```

### SSR Data Loading

Load initial data on server for instant rendering:

```typescript
// TanStack Start loader
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
```

## Troubleshooting

### Build Issues
- Ensure component builds before core: `bun run build:component && bun run build:core`
- Clear dist folders if stale: `bun run clean`
- Component requires both ESM and CommonJS builds

### Type Errors
- Run `bun run typecheck` to check all packages
- Ensure `convex` peer dependency version matches (^1.28.0)
- Check that Convex codegen is up to date: `convex dev` in example

### Linting/Formatting
- Run `bun run check:fix` before committing
- Note: `noExplicitAny` is disabled, but still prefer typed code
- Generated files are auto-excluded from linting

## Important Notes

- **Don't run dev servers** - They're managed by another process
- **Build order matters** - Component before Core
- **Dual-storage is required** - Both component and main tables needed
- **Automerge is the CRDT engine** - Not RxDB (common confusion)
- **LogTape for logging** - Not console.* (Biome warns on console usage)
- **Context7 for docs** - Always use for library documentation lookups
