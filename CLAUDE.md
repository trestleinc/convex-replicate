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
- `packages/component/` - Convex component for CRDT storage (@trestleinc/convex-replicate-component)
- `packages/core/` - Framework-agnostic replication helpers and SSR utilities (@trestleinc/convex-replicate-core)
- `packages/sharded-counter/` - Sharded counter example/component (experimental)
- `examples/tanstack-start/` - Example app using TanStack Start

## Available Scripts

### Build Commands
- `bun run build` - Build all packages (component → core in sequence)
- `bun run build:component` - Build only @trestleinc/convex-replicate-component package
- `bun run build:core` - Build only @trestleinc/convex-replicate-core package
- `bun run clean` - Remove all dist/ directories from packages

### Type Checking
- `bun run typecheck` - Type check all packages
- `bun run typecheck:component` - Type check only @trestleinc/convex-replicate-component
- `bun run typecheck:core` - Type check only @trestleinc/convex-replicate-core (uses tsc --noEmit)

**Note:** Component package uses TypeScript compiler (tsc) with dual ESM and CommonJS builds. Core package uses Rslib (Rspack-based) for faster builds with module externalization.

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

### @trestleinc/convex-replicate-component (`packages/component/`)

Convex component providing CRDT storage layer.

**Key Files:**
- `src/component/` - Component implementation (deployed to Convex)
  - `schema.ts` - Internal `documents` table schema
  - `public.ts` - Public API functions (insertDocument, updateDocument, deleteDocument, pullChanges, changeStream)
  - `convex.config.ts` - Component configuration
- `src/client/` - Type-safe client API
  - `index.ts` - `ReplicateStorage` class for interacting with component

**Build Output:**
- Dual package (ESM + CommonJS) in `dist/esm/` and `dist/commonjs/`
- Uses TypeScript compilation with separate tsconfig files (`esm.json`, `commonjs.json`)

**Storage Schema:**
```typescript
{
  collectionName: string;    // Collection identifier
  documentId: string;        // Document identifier
  crdtBytes: ArrayBuffer;    // Automerge CRDT bytes (opaque to server)
  version: number;           // Version for conflict detection
  timestamp: number;         // Last modification time
}
```

**Indexes:**
- `by_collection_document` - Lookup specific documents
- `by_collection` - Query all documents in a collection
- `by_timestamp` - Incremental sync support

### @trestleinc/convex-replicate-core (`packages/core/`)

Framework-agnostic utilities for replication and SSR.

**Key Files:**
- `src/index.ts` - Main exports (replication helpers, storage, logger, collection options)
- `src/replication.ts` - Dual-storage write/read helpers:
  - `insertDocumentHelper()` - Insert new document to both component and main table
  - `updateDocumentHelper()` - Update document in both component and main table
  - `deleteDocumentHelper()` - Delete document from both component and main table
  - `pullChangesHelper()` - Read CRDT bytes from component for incremental sync
  - `changeStreamHelper()` - Detect changes for reactive queries
- `src/ssr.ts` - `loadCollection()` for server-side data loading
- `src/store.ts` - `AutomergeDocumentStore` for managing Automerge documents (client-side only)
- `src/adapter.ts` - `SyncAdapter` for abstracting storage backends (client-side only)
- `src/convexCollectionOptions.ts` - TanStack DB collection options (client-side only)
- `src/logger.ts` - LogTape logger configuration

**Build Output:**
- Built with **Rslib** (Rspack-based bundler) to `dist/` directory
- Configured with ESM shims for `__dirname` and `__filename` support
- Externals: `@automerge/automerge`, `@automerge/automerge-repo-storage-indexeddb` (not bundled)
- Exports: `.` (main - all features), `./replication` (server-safe helpers only), `./ssr` (SSR utilities)

**Build Configuration:**
- `packages/core/rslib.config.ts` - Rslib configuration with 3 entry points
- Package size: ~65KB (reduced 57% from 150KB in v0.2.0 by externalizing Automerge)

**IMPORTANT**: Server-side Convex code must import from `@trestleinc/convex-replicate-core/replication` to avoid bundling Automerge WASM!

**Dependencies:**
- Requires `@tanstack/db` for collection options
- **Peer dependencies** (v0.2.1+): `@automerge/automerge ^3.1.2`, `@automerge/automerge-repo-storage-indexeddb ^2.4.0`, `convex ^1.28.0`

## Technology Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Bun
- **Build Tools:**
  - **Component package**: TypeScript compiler (tsc) with dual ESM + CommonJS builds
  - **Core package**: Rslib (Rspack-based, fast builds with externalization support)
- **Linting:** Biome v2
- **CRDTs:** Automerge 3.x with IndexedDB storage (peer dependency)
- **Backend:** Convex (cloud database and functions)
- **State Management:** TanStack DB for reactive collections
- **Logging:** LogTape
- **Testing:** Vitest (component package), TypeScript type checking

## Using ConvexReplicate in Your App

### 1. Install Component in Convex

```typescript
// convex/convex.config.ts
import { defineApp } from 'convex/server';
import replicate from '@trestleinc/convex-replicate-component/convex.config';

const app = defineApp();
app.use(replicate, { name: 'replicate' });

export default app;
```

### 2. Create Storage Instance

```typescript
// convex/tasks.ts
import { components } from './_generated/api';
import { ReplicateStorage } from '@trestleinc/convex-replicate-component';

const tasksStorage = new ReplicateStorage(components.replicate, 'tasks');
```

### 3. Use Replication Helpers

```typescript
// convex/tasks.ts (continued)
import {
  insertDocumentHelper,
  updateDocumentHelper,
  deleteDocumentHelper,
  pullChangesHelper,
  changeStreamHelper,
} from '@trestleinc/convex-replicate-core/replication';  // IMPORTANT: Use /replication to avoid Automerge on server!
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

### 4. Client-Side Integration (TanStack DB)

```typescript
import { AutomergeDocumentStore } from '@trestleinc/convex-replicate-core';
import { SyncAdapter } from '@trestleinc/convex-replicate-core';
import { convexCollectionOptions } from '@trestleinc/convex-replicate-core';
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
    tasks: convexCollectionOptions,
  },
});

// Start syncing
await adapter.sync();
```

## Key API Concepts

### ReplicateStorage Methods

- **`insertDocument(ctx, documentId, crdtBytes, version)`** - Insert new document with CRDT bytes
- **`updateDocument(ctx, documentId, crdtBytes, version)`** - Update existing document with CRDT bytes
- **`deleteDocument(ctx, documentId)`** - Delete document from storage
- **`pullChanges(ctx, checkpoint, limit?)`** - Pull CRDT bytes for incremental sync
- **`changeStream(ctx)`** - Subscribe to collection changes (reactive query)

### Replication Helpers (Server-Side)

**IMPORTANT**: Import from `@trestleinc/convex-replicate-core/replication` to avoid bundling Automerge on server!

- **`insertDocumentHelper(ctx, components, tableName, args)`** - Insert to both component (CRDT bytes) + main table (materialized doc)
- **`updateDocumentHelper(ctx, components, tableName, args)`** - Update both component + main table
- **`deleteDocumentHelper(ctx, components, tableName, args)`** - Delete from both component + main table
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
import { configureLogger, getLogger } from '@trestleinc/convex-replicate-core';

// Configure logging
configureLogger({
  level: 'debug', // 'debug' | 'info' | 'warn' | 'error'
  enableConsole: true,
});

// Get logger instance
const logger = getLogger('my-module');

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
2. **Save as bytes** - Client calls `Automerge.save()` to get CRDT bytes
3. **Insert** - Call `insertDocumentHelper` with both CRDT bytes + materialized doc
4. **Dual-write** - Component stores CRDT bytes, main table stores materialized doc
5. **Update** - Client merges changes offline using `Automerge.change()`, saves as bytes
6. **Submit update** - Call `updateDocumentHelper` with new CRDT bytes + materialized doc
7. **Conflict** - Automerge automatically merges concurrent changes on client (CRDT magic)

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

### Missing Peer Dependencies (v0.2.1+)
- **Error**: `Cannot find module '@automerge/automerge'`
- **Cause**: Only affects npm/yarn/pnpm users (Bun installs peer dependencies automatically)
- **Solution**: Install Automerge peer dependencies manually:
  ```bash
  # npm
  npm install @automerge/automerge @automerge/automerge-repo-storage-indexeddb
  
  # yarn/pnpm
  yarn/pnpm add @automerge/automerge @automerge/automerge-repo-storage-indexeddb
  ```
- See [MIGRATION-0.2.1.md](./MIGRATION-0.2.1.md) for details

### Type Errors
- Run `bun run typecheck` to check all packages
- Ensure peer dependencies are installed (Automerge, Convex ^1.28.0)
- Check that Convex codegen is up to date: `convex dev` in example

### Linting/Formatting
- Run `bun run check:fix` before committing
- Note: `noExplicitAny` is disabled, but still prefer typed code
- Generated files are auto-excluded from linting

## Important Notes

- **Don't run dev servers** - They're managed by another process
- **Build order matters** - Component before Core
- **Dual-storage is required** - Both component and main tables needed
- **Automerge is peer dependency** - Must be installed by users (v0.2.1+)
- **Automerge is the CRDT engine** - Not RxDB (common confusion)
- **Core uses Rslib** - Fast Rspack-based bundler with externalization (v0.2.1+)
- **Component uses tsc** - TypeScript compiler (Convex needs source files)
- **LogTape for logging** - Not console.* (Biome warns on console usage)
- **Context7 for docs** - Always use for library documentation lookups
