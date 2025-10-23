# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Always Use Context7 for Library Documentation

**CRITICAL**: When looking up documentation for any library (RxDB, React, Convex, TanStack, etc.), ALWAYS use the Context7 MCP tool (`mcp__context7__resolve-library-id` and `mcp__context7__get-library-docs`). NEVER use WebSearch for library documentation.

**Why:**
- Context7 provides accurate, up-to-date documentation with code examples
- WebSearch results can be outdated or incomplete
- Context7 has better code snippet coverage for technical libraries

**Usage pattern:**
1. First resolve the library ID: `mcp__context7__resolve-library-id` with library name
2. Then fetch docs: `mcp__context7__get-library-docs` with the resolved ID and topic

## Project Overview

**ConvexRx** - Offline-first sync library bridging RxDB (local) and Convex (cloud) for real-time data synchronization.

**Monorepo Structure:**
- `packages/core/` - Framework-agnostic sync engine (@convex-rx/core)
- `packages/react/` - React hooks with TanStack DB integration (@convex-rx/react)
- `examples/tanstack-start/` - Example app demonstrating usage

## Available Scripts

### Build Commands
- `bun run build` - Build all packages (core → react in sequence)
- `bun run build:core` - Build only @convex-rx/core package
- `bun run build:react` - Build only @convex-rx/react package
- `bun run clean` - Remove all dist/ directories from packages

### Type Checking
- `bun run typecheck` - Type check all packages (core + react)
- `bun run typecheck:core` - Type check only @convex-rx/core
- `bun run typecheck:react` - Type check only @convex-rx/react

**Note:** Type checking runs against all packages simultaneously using shared `tsconfig.base.json`

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

### Code Style
**NEVER use emojis** in code, comments, documentation, or commit messages. Keep all content professional and text-only.

### Dev Server Management
- **Do NOT run dev servers manually** - The development server is managed by another process
- If you need to start the example app, use `bun run dev:example` which handles both Vite and Convex

### Monorepo Conventions
- **Workspace dependencies** use `workspace:*` protocol in package.json
- **All packages share** the same Biome and TypeScript configuration from root
- **Type checking** runs against all packages simultaneously via root scripts
- **Example apps** each have their own Convex backend in their respective directories
- **Build order matters**: Core must build before React (handled by build script)

## TypeScript Coding Standards

### 1. Type Safety - No `any`

**NEVER use `any`**. Use specific types or `unknown` for truly unknown values.

❌ **Bad:**
```typescript
function handler(data: any) {
  return data.value;
}

const result: any = await fetch();
```

✅ **Good:**
```typescript
interface HandlerData {
  value: string;
}

function handler(data: HandlerData) {
  return data.value;
}

// For truly unknown values
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
```

### 2. Const Object Pattern Instead of Enums

**Use const objects with `as const`** instead of TypeScript enums.

❌ **Bad:**
```typescript
enum StorageType {
  DEXIE = 'dexie',
  MEMORY = 'memory',
}
```

✅ **Good:**
```typescript
export const StorageType = {
  Dexie: 'dexie',
  Memory: 'memory',
} as const;

export type StorageType = (typeof StorageType)[keyof typeof StorageType];
```

**Why:** Const objects are compile-time only (no runtime JS), provide better type inference, and work better with modern TypeScript.

### 3. Explicit Return Types

**Always add explicit return types** to exported functions and complex functions.

❌ **Bad:**
```typescript
export function createSchema(name: string, props: any) {
  return {
    title: name,
    properties: props,
  };
}
```

✅ **Good:**
```typescript
export function createSchema<T>(
  name: string,
  props: Record<string, PropertySchema>
): RxJsonSchema<T> {
  return {
    title: name,
    version: 0,
    type: 'object',
    primaryKey: 'id',
    properties: props,
    required: [],
  };
}
```

### 4. Trust TypeScript - Avoid Redundant Runtime Checks

**Do NOT add runtime validation that duplicates TypeScript's type guarantees.**

❌ **Bad:**
```typescript
function process(config: Config) {
  // TypeScript already ensures config.name is a string!
  if (typeof config.name !== 'string') {
    throw new Error('Name must be string');
  }

  // TypeScript already prevents null!
  if (!config.options) {
    return;
  }
}
```

✅ **Good:**
```typescript
function process(config: Config) {
  // Trust TypeScript - just use the values
  return doSomething(config.name, config.options);
}
```

**Exception:** Validate data from external sources (Convex API responses, user input).

### 5. No Double Type Assertions

**Never use `as unknown as`** - it bypasses all type checking.

❌ **Bad:**
```typescript
const doc = {
  ...partial,
  id: newId,
} as unknown as FullDocument;
```

✅ **Good:**
```typescript
const doc = {
  ...partial,
  id: newId,
} as FullDocument;

// Or even better, use a helper type
type WithMetadata<T> = T & { id: string; updatedTime: number };
const doc: WithMetadata<Partial<Document>> = {
  ...partial,
  id: newId,
  updatedTime: Date.now(),
};
```

### 6. Generic Constraints

**Use specific generic constraints** instead of `any` or overly broad constraints.

❌ **Bad:**
```typescript
function process<T = any>(items: T[]) {
  return items;
}
```

✅ **Good:**
```typescript
function process<T extends SyncedDocument>(items: T[]) {
  return items.filter(item => !item._deleted);
}
```

### 7. Null Safety

**Use optional chaining and nullish coalescing** appropriately.

✅ **Good:**
```typescript
// Optional chaining
await convexClient.close?.();

// Nullish coalescing (preserves false, 0, '')
const batchSize = config.batchSize ?? 100;

// Use || only for truly falsy fallbacks
const name = config.name || 'default';
```

## Logging Standards

### Use LogTape, Never Console

**ALWAYS use LogTape logger**, never `console.*`

❌ **Bad:**
```typescript
console.log('Starting sync');
console.warn('Invalid data:', data);
console.error('Sync failed:', error);
```

✅ **Good:**
```typescript
import { getLogger } from './logger';

const logger = getLogger('sync-engine', config.enableLogging);

logger.info('Starting sync', { table: 'tasks' });
logger.warn('Invalid data received', { data, reason: 'missing id' });
logger.error('Sync failed', { error, table: 'tasks' });
```

**Logger Levels:**
- `logger.debug()` - Detailed debugging info (only when enableLogging=true)
- `logger.info()` - General informational messages
- `logger.warn()` - Warning conditions
- `logger.error()` - Error conditions

**Best Practices:**
- Always pass context as second parameter (object)
- Use structured data, not string interpolation
- Enable logging via config, not hardcoded

```typescript
// ✅ Good - structured context
logger.info('Document synced', {
  documentId: doc.id,
  table: 'tasks',
  timestamp: doc.updatedTime
});

// ❌ Bad - string interpolation
logger.info(`Document ${doc.id} synced to ${table}`);
```

## Validation Standards

### When to Use Zod vs TypeScript

**Zod:** Validate data from external sources
**TypeScript:** Internal type safety

✅ **Use Zod for:**
```typescript
// Validating config from users
const configSchema = z.object({
  databaseName: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  batchSize: z.number().int().min(1).max(1000),
});

configSchema.parse(userConfig);

// Validating data from Convex API
const convexResponseSchema = z.object({
  documents: z.array(z.any()),
  checkpoint: z.object({
    id: z.string(),
    updatedTime: z.number(),
  }),
});
```

✅ **Trust TypeScript for:**
```typescript
// Internal function parameters
function processDocument(doc: SyncedDocument, table: string) {
  // No need to validate - TypeScript guarantees types
  return {
    id: doc.id,
    table: table,
  };
}

// Enum/const object values
const storage = config.type ?? StorageType.Dexie;
// No need to validate - TypeScript enforces StorageType
```

## Network Error Handling

### Pattern for Network Requests

```typescript
import { isNetworkError } from './types';
import { getLogger } from './logger';

const logger = getLogger('network', enableLogging);

async function syncData() {
  try {
    const result = await convexClient.query(api.table.pullDocuments, {
      checkpoint,
      limit: batchSize,
    });

    return result;
  } catch (error) {
    // Check if it's a network error
    if (isNetworkError(error)) {
      logger.warn('Network error during sync', {
        error: error instanceof Error ? error.message : String(error),
        willRetry: true
      });
      // Handle network-specific recovery
      return handleNetworkFailure();
    }

    // Non-network errors
    logger.error('Sync error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}
```

**Network Error Detection:**
```typescript
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('fetch') ||
      message.includes('network') ||
      message.includes('offline') ||
      message.includes('connection')
    );
  }
  return false;
}
```

## Project Structure

### Core Package (`packages/core/`)
Framework-agnostic sync utilities:
- `src/index.ts` - Main exports with organized sections
- `src/rxdb.ts` - Core sync engine (`createConvexRxDB`)
- `src/singleton.ts` - Generic singleton manager
- `src/middleware.ts` - Middleware execution for CRUD operations
- `src/subscriptions.ts` - Subscription builder utilities
- `src/actions.ts` - Base CRUD action factory with adapter pattern
- `src/types.ts` - Type definitions (`SyncedDocument`, `ConvexClient`, `PropertySchema`)
- `src/conflictHandler.ts` - Conflict resolution strategies
- `src/logger.ts` - LogTape logging abstraction
- `src/schema.ts` - RxDB schema builder with property helpers
- `src/convex.ts` - Convex function generator (`generateConvexRxFunctions`)
- `src/storage.ts` - Storage adapters (Dexie, LocalStorage, Memory)

### React Package (`packages/react/`)
React-specific wrapper:
- `src/index.ts` - Main exports (React-specific only)
- `src/createConvexRx.ts` - Internal wrapper adding TanStack DB to core
- `src/useConvexRx.ts` - React hook with automatic singleton management
- `src/ConvexRxProvider.tsx` - Required provider for global configuration
- `src/ssr.ts` - SSR data preloading (`preloadConvexRxData`)
- `src/types.ts` - React-specific types (`HookContext`, `UseConvexRxConfig`)

### Example App (`examples/tanstack-start/`)
Complete working example:
- `src/hooks/useTasks.ts` - Example hook with custom actions/queries
- `src/routes/index.tsx` - Component usage
- `src/routes/__root.tsx` - ConvexRxProvider setup
- `convex/tasks.ts` - Auto-generated Convex functions
- `vite.config.ts` - Vite + TanStack Start configuration

## Architecture Patterns

### Core + Framework Wrapper Pattern

**Core Package** (`@convex-rx/core`):
- Framework-agnostic utilities
- Pure TypeScript, no React/Vue/etc dependencies
- Exports: `createConvexRxDB`, `getSingletonInstance`, `createBaseActions`, etc.

**React Package** (`@convex-rx/react`):
- Thin wrapper around core
- Adds TanStack DB integration
- Exports: `useConvexRx`, `ConvexRxProvider`

### Singleton Management

**Always use singleton pattern** to prevent duplicate database instances:

```typescript
import { getSingletonInstance, createSingletonKey } from '@convex-rx/core';

const instance = await getSingletonInstance(config, {
  keyFn: (cfg) => createSingletonKey(cfg.databaseName, cfg.collectionName),
  createFn: async (cfg) => await createConvexRxDB(cfg),
});
```

**Why:** Prevents race conditions, memory leaks, and duplicate WebSocket connections.

### Middleware Pattern

Use middleware for cross-cutting concerns:

```typescript
const middleware: MiddlewareConfig<Task> = {
  beforeInsert: async (doc) => {
    logger.info('Inserting document', { id: doc.id });
    return doc;
  },

  afterUpdate: async (id, updates) => {
    logger.info('Document updated', { id, updates });
  },

  onSyncError: (error) => {
    logger.error('Sync error occurred', { error });
  },
};
```

## Important Convex Patterns

### Required Fields for Synced Documents

```typescript
interface YourDocument {
  id: string;           // Client-generated UUID
  updatedTime: number;  // Auto-managed by sync engine
  _deleted?: boolean;   // Soft delete flag
  // ... your fields
}
```

### Convex Function Generator

**Use the generator** instead of manually writing functions:

```typescript
// convex/yourTable.ts
import { generateConvexRxFunctions } from '@convex-rx/core/convex';
import { query, mutation } from './_generated/server';
import { v } from 'convex/values';

const tableFunctions = generateConvexRxFunctions({
  tableName: 'yourTable',
  query,
  mutation,
  v,
});

export const changeStream = tableFunctions.changeStream;
export const pullDocuments = tableFunctions.pullDocuments;
export const pushDocuments = tableFunctions.pushDocuments;
```

### Soft Deletes

**Never hard delete** - always use soft deletes:

```typescript
// ❌ Bad - hard delete
await collection.remove(id);

// ✅ Good - soft delete (built into actions)
await actions.delete(id); // Sets _deleted: true
```

## File Organization

### Import Order
1. External dependencies
2. Core package imports
3. Local/relative imports
4. Types (use `import type` when possible)

```typescript
// External
import { Subject } from 'rxjs';
import { createRxDatabase } from 'rxdb';

// Core package
import { getLogger, type SyncedDocument } from '@convex-rx/core';

// Local
import { createSchema } from './schema';
import type { Config } from './types';
```

### Export Organization

Use barrel exports (`index.ts`) with clear sections:

```typescript
// ========================================
// CORE DATABASE & REPLICATION
// ========================================
export { createConvexRxDB } from './rxdb';
export { getSingletonInstance } from './singleton';

// ========================================
// TYPE DEFINITIONS
// ========================================
export type { SyncedDocument, ConvexClient } from './types';
```


## Technology Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Bun
- **Build:** tsup (packages), Vite (example)
- **Linting:** Biome v2
- **Database:** RxDB (local) + Convex (cloud)
- **Logging:** LogTape
- **Validation:** Zod (external data only)
- **Testing:** TypeScript type checking

## Common Pitfalls to Avoid

1. Using `any` instead of `unknown` or specific types
2. Using enums instead of const objects
3. Adding runtime checks that duplicate TypeScript
4. Using `console.*` instead of LogTape
5. Double type assertions (`as unknown as`)
6. Hard deletes instead of soft deletes
7. Creating multiple database instances instead of singletons
8. Validating internal TypeScript types with Zod
9. Missing explicit return types on exported functions
10. Not using Context7 for library documentation
11. Using emojis in code, comments, or documentation
