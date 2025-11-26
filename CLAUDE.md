# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Always Use Context7 for Library Documentation

**CRITICAL**: When looking up documentation for any library (Yjs, Convex, TanStack, Effect, etc.), ALWAYS use the Context7 MCP tool. NEVER use WebSearch for library documentation.

**Usage pattern:**
1. First resolve the library ID: `mcp__context7__resolve-library-id` with library name
2. Then fetch docs: `mcp__context7__get-library-docs` with the resolved ID and topic

## Project Overview

**ConvexReplicate** (`@trestleinc/replicate`) - Offline-first data replication using Yjs CRDTs and Convex for automatic conflict resolution and real-time synchronization.

Single package with exports:
- `@trestleinc/replicate/client` → Client utilities (browser/React/Svelte)
- `@trestleinc/replicate/server` → Server helpers (Convex functions)
- `@trestleinc/replicate/convex.config` → Component configuration

## Development Commands

### Build & Type Check
```bash
pnpm run build       # Build with Rslib (outputs to dist/)
pnpm run clean       # Remove dist/
pnpm run typecheck   # Type check entire package
```

### Testing
```bash
pnpm run test           # Run tests in watch mode (vitest)
pnpm run test:run       # Run tests once
pnpm run test:coverage  # Run with coverage report

# Run specific test file
pnpm run test src/test/unit/merge.test.ts

# Run tests matching pattern
pnpm run test -t "should merge"
```

Tests use `fake-indexeddb` for IndexedDB mocking and `jsdom` environment. Test files are in `src/test/`.

### Code Quality (Biome v2)
```bash
pnpm run check       # Lint + format check (dry run)
pnpm run check:fix   # Auto-fix all issues (ALWAYS run before committing)
```

### Examples
```bash
cd examples/tanstack-start  # or examples/sveltekit
pnpm install
pnpm run dev          # App + Convex dev server
```

## Architecture

### Package Structure
```
src/
├── client/              # Client-side (browser)
│   ├── index.ts         # Public exports
│   ├── collection.ts    # TanStack DB + Yjs integration
│   ├── set.ts           # setReplicate() setup
│   ├── replicate.ts     # Replicate helpers for TanStack DB
│   ├── merge.ts         # Yjs CRDT merge operations
│   ├── logger.ts        # LogTape logger
│   ├── errors.ts        # Error definitions
│   └── services/        # Core services (Effect-based)
│       ├── CheckpointService.ts  # Sync checkpoints
│       ├── ProtocolService.ts    # Protocol version management
│       ├── SnapshotService.ts    # Snapshot recovery
│       └── ReconciliationService.ts # Phantom document cleanup
├── server/              # Server-side (Convex functions)
│   ├── index.ts         # Public exports
│   ├── builder.ts       # defineReplicate() builder
│   ├── schema.ts        # replicatedTable() helper
│   ├── storage.ts       # ReplicateStorage class
│   └── errors.ts        # Server error definitions
├── component/           # Internal Convex component
│   ├── convex.config.ts # Component config
│   ├── schema.ts        # Event log schema
│   └── public.ts        # Component API
└── test/                # Test files
    ├── setup.ts         # Vitest setup (fake-indexeddb)
    ├── mocks/           # Test mocks
    └── unit/            # Unit tests
```

### Core Concepts

**Event-Sourced Dual Storage:**
- Component storage: Append-only Yjs CRDT deltas (event log)
- Main table: Materialized documents (read model)
- Similar to CQRS pattern

**Client Services (Effect-based):**
- Services in `src/client/services/` use Effect for dependency injection
- `CheckpointService` manages sync checkpoints in IndexedDB
- `ProtocolService` handles protocol version negotiation
- `SnapshotService` recovers from server snapshots
- `ReconciliationService` removes phantom documents

**Data Flow:**
```
Client edit → merge.ts (encode delta) → collection.ts → Offline queue
    → Convex mutation → Component (append delta) + Main table (upsert)
    → Subscription → Other clients
```

## Key Patterns

### Server: defineReplicate Builder
```typescript
// convex/tasks.ts
import { defineReplicate } from '@trestleinc/replicate/server';

export const { stream, material, insert, update, remove, protocol, compact, prune } =
  defineReplicate<Task>({
    component: components.replicate,
    collection: 'tasks',
  });
```

### Client: Collection Setup
```typescript
// Use convexCollectionOptions + createConvexCollection pattern
const rawCollection = createCollection(convexCollectionOptions<Task>({ ... }));
const collection = createConvexCollection(rawCollection);
```

### Schema: replicatedTable Helper
```typescript
// Automatically injects version and timestamp fields
tasks: replicatedTable({ id: v.string(), text: v.string() }, (t) => t.index('by_id', ['id']))
```

## Technology Stack

- **TypeScript** (strict mode)
- **Effect** for service architecture and dependency injection
- **Yjs** for CRDTs (conflict-free replicated data types)
- **Convex** for backend (cloud database + functions)
- **TanStack DB** for reactive state
- **TanStack offline-transactions** for outbox pattern
- **Vitest** for testing
- **Rslib** for building
- **Biome** for linting/formatting
- **LogTape** for logging (avoid console.*)

## Important Notes

- **Effect-based services** - Client services use Effect for DI; understand Effect basics
- **Hard deletes** - Documents physically removed from main table, history kept in component
- **pnpm for examples** - Examples use `file:` protocol which requires pnpm
- **Biome config** - `noExplicitAny` OFF, `noConsole` warns except in tests
- **LogTape logging** - Use LogTape, not console.* (Biome warns on console)
