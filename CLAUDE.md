# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **monorepo** containing reusable packages for offline-first sync architecture using:
- **RxDB** - Local database with offline storage
- **Convex** - Real-time cloud database with WebSocket streaming
- **TanStack DB** - Reactive state management for React
- **RxJS** - Reactive programming primitives

The packages provide a complete sync solution:
- `@convex-rx/core` - Framework-agnostic sync engine bridging RxDB and Convex
- `@convex-rx/react` - React hooks with TanStack DB integration

## Monorepo Structure

```
convex-rx/
├── packages/
│   ├── core/          # @convex-rx/core - Core RxDB + Convex sync engine (framework-agnostic)
│   └── react/         # @convex-rx/react - React hooks + TanStack DB wrapper
├── examples/
│   └── tanstack-start/  # Example TanStack Start app demonstrating usage
│       ├── src/         # Application source code
│       ├── convex/      # Convex backend functions
│       └── package.json # Example app dependencies
├── biome.json         # Root Biome configuration
├── tsconfig.base.json # Shared TypeScript configuration
└── bunfig.toml        # Bun workspace configuration
```

## Commands

### Build & Development
- `bun run build` - Build all packages (core + react)
- `bun run build:core` - Build only @convex-rx/core
- `bun run build:react` - Build only @convex-rx/react
- `bun run typecheck` - Type check all packages
- `bun run clean` - Remove all build artifacts

### Example App
- `bun run dev:example` - Start both the TanStack Start app AND Convex dev environment (runs concurrently)
- `bun run build:example` - Build the example app for production

**Note**: The dev:example script automatically starts both:
  - Vite dev server on port 3000
  - Convex dev environment with WebSocket sync

Within `examples/tanstack-start/`, you can also run:
  - `bun run dev:app` - Run only the Vite dev server
  - `bun run dev:convex` - Run only Convex dev environment

### Code Quality (Biome)
- `bun run lint` - Lint all files
- `bun run lint:fix` - Lint and auto-fix issues
- `bun run format` - Format all files
- `bun run format:check` - Check formatting without modifying
- `bun run check` - Combined lint + format check (useful for CI)
- `bun run check:fix` - Combined lint + format with auto-fixes

### Biome Configuration
- Root `biome.json` contains shared configuration for all packages
- Biome v2 supports monorepos with VCS integration enabled
- File ignores configured for common build artifacts and dependencies
- Override rules for config files and test files

## Architecture

### Data Flow (3-Layer Sync)
```
React Components ↔ TanStack DB ↔ RxDB ↔ Convex (via WebSocket streams)
     (UI)        (reactive)   (local)      (cloud)
```

1. **React → TanStack DB**: Components subscribe to reactive collections
2. **TanStack DB → RxDB**: Automatic persistence to local database
3. **RxDB ↔ Convex**: Bidirectional sync via WebSocket change streams

### Sync Engine Pattern

The packages use a **core + framework wrapper pattern**:

#### Core Package (`@convex-rx/core`)
Framework-agnostic utilities that can be reused across any JavaScript framework:
- `createConvexRxDB()` - Creates RxDB database with Convex replication
- `getSingletonInstance()` / `createSingletonKey()` - Prevents race conditions during init
- `createBaseActions()` - CRUD action factory with adapter pattern
- `wrapActionsWithMiddleware()` - Before/after hooks for operations
- `buildSubscriptions()` - Subscription builder utilities
- Returns: `{ rxDatabase, rxCollection, replicationState, cleanup }`

#### React Package (`@convex-rx/react`)
Thin wrapper consuming core utilities + TanStack DB integration:
- `useConvexRx()` - React hook with automatic singleton management
- `ConvexRxProvider` - Optional provider for shared configuration
- Uses `createConvexRx()` internally (wraps core with TanStack DB)
- Returns: `{ data, isLoading, error, insert, update, delete, actions, queries, subscribe }`

#### Usage Pattern (see `examples/tanstack-start/src/useTasks.ts`)

```typescript
import { useConvexRx, type SyncedDocument } from '@convex-rx/react';
import type { RxJsonSchema } from '@convex-rx/core';
import { api } from '../convex/_generated/api';

// 1. Define your data type (must extend SyncedDocument)
type Task = {
  text: string;
  isCompleted: boolean;
} & SyncedDocument; // Adds id, updatedTime, _deleted

// 2. Define RxDB schema
const schema: RxJsonSchema<Task> = { /* ... */ };

// 3. Create React hook - singleton management is automatic
export function useTasks() {
  return useConvexRx({
    table: 'tasks',
    schema,
    convexApi: {
      changeStream: api.tasks.changeStream,
      pullDocuments: api.tasks.pullDocuments,
      pushDocuments: api.tasks.pushDocuments
    }
  });
}

// 4. Use in components
const { data, isLoading, insert, update, delete: remove } = useTasks();
```

**Why singleton pattern?**: The hook automatically manages singleton instances internally using core utilities, preventing multiple database connections during React re-renders or hot module replacement in development.

### Required Convex Functions (per synced table)

Each synced table needs three functions (see `examples/tanstack-start/convex/tasks.ts`):

1. **`changeStream`** (query)
   - Returns `{ timestamp, count }` of latest changes
   - Used by WebSocket to detect when to trigger sync
   - Called automatically via `watchQuery()`

2. **`pullDocuments`** (query)
   - Args: `checkpointTime: number, limit: number`
   - Returns documents modified after checkpoint
   - Ordered by `updatedTime` descending

3. **`pushDocuments`** (mutation)
   - Args: `changeRows: Array<{ newDocumentState, assumedMasterState }>`
   - Handles conflict detection and resolution
   - Returns conflicting documents (server-wins strategy)
   - Supports soft deletes via `_deleted` field

### Required Data Fields

All synced types must include:
```typescript
{
  id: string;           // Client-generated UUID
  updatedTime: number;  // Replication timestamp (auto-managed)
  _deleted?: boolean;   // Soft delete flag (auto-managed)
  // ...your custom fields
}
```

### Conflict Resolution

ConvexRx provides built-in conflict resolution strategies to handle when multiple clients edit the same document simultaneously.

#### How Conflicts Are Detected

Conflicts occur when:
1. Client A and Client B both read a document (e.g., `updatedTime: 100`)
2. Client A modifies it locally (new state with `updatedTime: 200`)
3. Client B also modifies it locally (new state with `updatedTime: 150`)
4. Client A pushes first → succeeds, server now has `updatedTime: 200`
5. Client B pushes → **conflict detected** because server state (200) ≠ assumed state (100)

#### Available Strategies

**1. Last-Write-Wins (Default)**
```typescript
import { useConvexRx } from '@convex-rx/react';
import { createLastWriteWinsHandler } from '@convex-rx/core';

useConvexRx({
  table: 'yourTable',
  schema: yourSchema,
  convexApi: api.yourTable,
  conflictHandler: createLastWriteWinsHandler<YourType>(),
});
```
- Compares `updatedTime` timestamps
- Newest change wins, regardless of source
- **Best for**: General use cases where timing matters

**2. Server-Wins**
```typescript
import { useConvexRx } from '@convex-rx/react';
import { createServerWinsHandler } from '@convex-rx/core';

useConvexRx({
  table: 'yourTable',
  schema: yourSchema,
  convexApi: api.yourTable,
  conflictHandler: createServerWinsHandler<YourType>(),
});
```
- Always uses server state when conflicts occur
- Local changes are discarded
- **Best for**: When server is source of truth (e.g., inventory, pricing)

**3. Client-Wins**
```typescript
import { useConvexRx } from '@convex-rx/react';
import { createClientWinsHandler } from '@convex-rx/core';

useConvexRx({
  table: 'yourTable',
  schema: yourSchema,
  convexApi: api.yourTable,
  conflictHandler: createClientWinsHandler<YourType>(),
});
```
- Always uses client state, overwriting server
- ⚠️ **Warning**: Can cause data loss with concurrent edits
- **Best for**: Single-user scenarios or when local edits must persist

**4. Custom Merge**
```typescript
import { useConvexRx } from '@convex-rx/react';
import { createCustomMergeHandler } from '@convex-rx/core';

useConvexRx({
  table: 'yourTable',
  schema: yourSchema,
  convexApi: api.yourTable,
  conflictHandler: createCustomMergeHandler<YourType>((input) => {
    // input.realMasterState - current server state
    // input.newDocumentState - local client state
    // input.assumedMasterState - what client thought was on server

    // Example: Merge specific fields
    return {
      ...input.realMasterState,
      // Keep local user changes
      text: input.newDocumentState.text,
      // But use server's completion status
      isCompleted: input.realMasterState.isCompleted,
      // Use newest timestamp
      updatedTime: Math.max(
        input.realMasterState.updatedTime,
        input.newDocumentState.updatedTime
      ),
    };
  }),
});
```
- Full control over conflict resolution
- **Best for**: Complex business logic or field-level merging

#### Conflict Resolution Flow

```
1. Client modifies document locally
2. RxDB detects change and queues for push
3. Push handler sends: { newDocumentState, assumedMasterState }
4. Server compares assumedMasterState with realMasterState
5. If different → conflict detected, returns realMasterState
6. Client receives conflict
7. RxDB calls conflictHandler.isEqual() to verify conflict
8. If conflict confirmed, calls conflictHandler.resolve()
9. Resolved document is applied locally
10. Client retries push with resolved state
```

#### Best Practices

- **Use `updatedTime` comparisons**: More efficient than deep equality checks
- **Log conflicts**: Add logging in custom handlers to track resolution frequency
- **Test with multiple clients**: Open app in multiple tabs to simulate concurrent edits
- **Consider UI feedback**: Show users when their changes were overridden by conflicts

### Key Implementation Details

- **WebSocket Change Detection**: Uses Convex `watchQuery()` to monitor `changeStream` query
- **Cross-tab Sync**: RxDB multiInstance mode enables automatic tab synchronization
- **Soft Deletes**: Items marked with `_deleted: true` instead of hard deletion
- **Hot Reload Safety**: Development mode uses `ignoreDuplicate` and cleanup on `beforeunload`

## File Structure

### Core Package (`packages/core/`)
Framework-agnostic utilities:
- `src/index.ts` - Main package exports with organized sections
- `src/rxdb.ts` - Core sync engine (createConvexRxDB)
- `src/singleton.ts` - Generic singleton manager (128 lines)
- `src/middleware.ts` - Middleware execution for CRUD operations (151 lines)
- `src/subscriptions.ts` - Subscription builder utilities (75 lines)
- `src/actions.ts` - Base CRUD action factory with adapter pattern (127 lines)
- `src/types.ts` - TypeScript type definitions (SyncedDocument, BaseActions, MiddlewareConfig)
- `src/conflictHandler.ts` - Conflict resolution strategies
- `src/logger.ts` - Logging abstraction utility
- `src/schemaBuilder.ts` - RxDB schema builder utilities
- `src/convex.ts` - Convex function generators
- `package.json` - Package configuration with RxDB/RxJS dependencies
- `tsconfig.json` - TypeScript configuration extending base

### React Package (`packages/react/`)
Thin wrapper consuming core utilities:
- `src/index.ts` - Main package exports (React-specific only, core types imported separately)
- `src/createConvexRx.ts` - Internal wrapper adding TanStack DB to core sync
- `src/useConvexRx.ts` - React hook with automatic singleton management (~350 lines)
- `src/ConvexRxProvider.tsx` - Optional provider for shared configuration
- `src/types.ts` - React-specific types only (HookContext, UseConvexRxConfig, UseConvexRxResult)
- `package.json` - Package configuration with @convex-rx/core + TanStack DB
- `tsconfig.json` - TypeScript configuration with JSX support

**Note**: React package no longer contains internal/ folder - all utilities moved to core

### Example App (`examples/tanstack-start/`)
- `src/useTasks.ts` - Example usage of @convex-rx/react
- `src/routes/` - TanStack Start file-based routes
- `src/router.tsx` - Router configuration with QueryClient + ConvexReactClient
- `convex/tasks.ts` - Convex backend functions (changeStream, pull, push)
- `vite.config.ts` - Vite + TanStack Start configuration
- `package.json` - Example app dependencies

## Technology Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Bun
- **Build Tool**: tsup (packages), Vite (example app)
- **Code Quality**: Biome v2 (linting + formatting)
- **Database**: RxDB (local) + Convex (cloud)
- **Reactivity**: RxJS (core), TanStack DB (React)
- **Framework**: TanStack Start (example app)
- **Monorepo**: Bun workspaces

## Adding New Packages to the Monorepo

To add a new package (e.g., `@convex-rx/react`):

1. **Create package directory**:
   ```bash
   mkdir -p packages/react/src
   ```

2. **Create `packages/react/package.json`**:
   ```json
   {
     "name": "@convex-rx/react",
     "version": "0.1.0",
     "type": "module",
     "main": "./dist/index.js",
     "types": "./dist/index.d.ts",
     "dependencies": {
       "@convex-rx/core": "workspace:*"
     },
     "peerDependencies": {
       "react": "^18.0.0 || ^19.0.0"
     }
   }
   ```

3. **Create `packages/react/tsconfig.json`**:
   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": {
       "outDir": "./dist",
       "rootDir": "./src"
     },
     "include": ["src"]
   }
   ```

4. **(Optional) Create `packages/react/biome.json`** for package-specific rules:
   ```json
   {
     "extends": "//",
     "linter": {
       "rules": {
         "suspicious": {
           "noConsoleLog": "off"
         }
       }
     }
   }
   ```

   The `"extends": "//"` microsyntax inherits from the root `biome.json`.

5. **Update root `package.json` scripts** to include the new package:
   ```json
   {
     "scripts": {
       "build": "bun run build:core && bun run build:react",
       "build:react": "cd packages/react && bun run build"
     }
   }
   ```

## Development Notes

- **Do not run dev servers** - The development server is manually handled by another process
- Use `bun run check:fix` before committing to ensure code quality
- All packages share the same Biome and TypeScript configuration from the root
- Workspace dependencies use `workspace:*` protocol in package.json
- Type checking runs against all packages simultaneously
- Example apps each have their own Convex backend in their respective directories
