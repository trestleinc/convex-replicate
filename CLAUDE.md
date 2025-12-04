# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Always Use Context7 for Library Documentation

**CRITICAL**: When looking up documentation for any library (Yjs, Convex, TanStack, Effect, etc.), ALWAYS use the Context7 MCP tool. NEVER use WebSearch for library documentation.

**Usage pattern:**
1. First resolve the library ID: `mcp__context7__resolve-library-id` with library name
2. Then fetch docs: `mcp__context7__get-library-docs` with the resolved ID and topic

## Project Overview

**Replicate** (`@trestleinc/replicate`) - Offline-first data replication using Yjs CRDTs and Convex for automatic conflict resolution and real-time synchronization.

Single package with exports:
- `@trestleinc/replicate/client` → Client utilities (browser/React/Svelte)
- `@trestleinc/replicate/server` → Server helpers (Convex functions)
- `@trestleinc/replicate/convex.config` → Component configuration

## Development Commands

### Build & Type Check
```bash
pnpm run build       # Build with Rslib (outputs to dist/)
pnpm run clean       # Remove dist/
```

### Code Quality (Biome v2)
```bash
pnpm run check       # Lint + format check (dry run)
pnpm run check:fix   # Auto-fix all issues (ALWAYS run before committing)
```

### Publishing
```bash
bun run prepublish   # Build + check:fix (runs before npm publish)
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
│   ├── history.ts       # Undo/redo history management
│   ├── logger.ts        # LogTape logger
│   ├── errors.ts        # Error definitions
│   └── services/        # Core services (Effect-based)
│       ├── checkpoint.ts     # Sync checkpoints
│       ├── protocol.ts       # Protocol version management
│       ├── snapshot.ts       # Snapshot recovery
│       └── reconciliation.ts # Phantom document cleanup
├── server/              # Server-side (Convex functions)
│   ├── index.ts         # Public exports
│   ├── builder.ts       # defineReplicate() builder
│   ├── schema.ts        # replicatedTable() helper
│   └── storage.ts       # ReplicateStorage class
├── component/           # Internal Convex component
│   ├── convex.config.ts # Component config
│   ├── schema.ts        # Event log schema
│   ├── public.ts        # Component API
│   └── logger.ts        # Component logging
└── env.d.ts             # Environment type declarations
```

### Core Concepts

**Event-Sourced Dual Storage:**
- Component storage: Append-only Yjs CRDT deltas (event log)
- Main table: Materialized documents (read model)
- Similar to CQRS pattern

**Client Services (Effect-based):**
- Services in `src/client/services/` use Effect for dependency injection
- `Checkpoint` manages sync checkpoints in IndexedDB
- `Protocol` handles protocol version negotiation
- `Snapshot` recovers from server snapshots
- `Reconciliation` removes phantom documents

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
// Use convexCollectionOptions + handleReconnect pattern
const collection = handleReconnect(
  createCollection(
    convexCollectionOptions<Task>({
      convexClient,
      api: api.tasks,
      collection: 'tasks',
      getKey: (task) => task.id,
    })
  )
);
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
- **Rslib** for building
- **Biome** for linting/formatting
- **LogTape** for logging (avoid console.*)

## Naming Conventions

- **Service files**: lowercase, no suffix (e.g., `checkpoint.ts`, not `CheckpointService.ts`)
- **Service exports**: PascalCase, no "Service" suffix (e.g., `Checkpoint`, `CheckpointLive`)
- **Use "replicate"**: not "sync" throughout the codebase

## Important Notes

- **Effect-based services** - Client services use Effect for DI; understand Effect basics
- **Hard deletes** - Documents physically removed from main table, history kept in component
- **Biome config** - `noExplicitAny` OFF, `noConsole` warns (except in test files and component logger)
- **LogTape logging** - Use LogTape, not console.* (Biome warns on console)
- **Import types** - Use `import type` for type-only imports (Biome enforces this)
