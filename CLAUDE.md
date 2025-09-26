# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Note**: This is the main template repository. The `tansync/` directory has been moved to a separate location for migration work using git worktrees.

## Commands

### Development
- `bun run dev` - Start development server (runs on port 3000)
- `bun run build` - Build the application for production
- `bun run preview` - Preview the production build

### Data Management
- `bunx convex import --table tasks sampleData.jsonl` - Import sample task data
- `bunx convex dev` - Start Convex development backend (if needed)

### Linting & Type Checking
- Use Biome for code formatting and linting via `@biomejs/biome` package
- TypeScript type checking is included in the build process (`tsc --noEmit`)

## Architecture Overview

This project demonstrates a complete **offline-first sync solution** combining:

- **Frontend**: React with TanStack Router for routing
- **State Management**: TanStack DB for reactive collections
- **Local Database**: RxDB for offline storage and querying
- **Backend**: Convex for real-time cloud database with streaming
- **Sync Engine**: Custom bidirectional sync between RxDB and Convex

### Key Architectural Components

#### Sync Engine (`src/sync/`)
- `createConvexSync.ts` - Factory for creating table-specific sync instances
- `useConvexSync.ts` - React hook for consuming sync instances with CRUD operations
- `README.md` - Detailed sync engine API documentation

#### Data Flow Pattern
1. **React Components** ↔ **TanStack DB Collections** (reactive UI updates)
2. **TanStack DB** ↔ **RxDB** (local persistence)
3. **RxDB** ↔ **Convex Streams** (real-time bidirectional sync)
4. **Conflict Resolution**: Server-wins strategy with automatic handling

#### Required Convex Functions (per table)
Each synced table needs three Convex functions:
- `changeStream` - WebSocket-based change detection
- `pullDocuments` - Fetch changes from server
- `pushDocuments` - Send local changes to server

#### Data Type Requirements
All synced entities must include:
- `id: string` - Primary key (client-generated)
- `updatedTime: number` - Replication timestamp
- `_deleted?: boolean` - Soft delete flag

### File Structure

- `src/useTasks.ts` - Complete example of sync hook implementation
- `convex/tasks.ts` - Convex backend functions for task sync
- `src/routes/` - TanStack Router file-based routing
- `rsbuild.config.ts` - Rsbuild configuration with TanStack Router plugin

### Sync Instance Pattern

The codebase uses a singleton pattern for sync instances to ensure proper resource management:

```typescript
let syncInstance: Promise<any> | null = null;

async function getSyncInstance() {
  if (!syncInstance) {
    syncInstance = createConvexSync({ /* config */ });
  }
  return syncInstance;
}
```

### Development Notes

- The dev server should not be started via Claude Code as it's managed by another process
- RxDB and TanStack DB handle cross-tab synchronization automatically
- Convex streams provide real-time updates without manual WebSocket management
- All CRUD operations are optimistic with automatic conflict resolution

## Technology Stack

- **Build Tool**: Rsbuild with React plugin
- **Frontend**: React 19, TanStack Router, TanStack DB
- **Database**: RxDB (local), Convex (cloud)
- **Styling**: Tailwind CSS 4.x
- **Language**: TypeScript with strict configuration
- **Package Manager**: Bun