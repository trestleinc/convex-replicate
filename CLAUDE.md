# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **example/template project** demonstrating offline-first sync architecture using:
- **TanStack Router** - File-based routing
- **TanStack DB** - Reactive state management with collections
- **RxDB** - Local database with offline storage
- **Convex** - Real-time cloud database with WebSocket streaming

**Note**: This is not a published library/adapter. The sync engine code in `src/sync/` is example implementation meant to be copied and adapted for your own projects.

## Commands

### Development
- `bun run dev` - Start development server (port 3000)
- `bun run build` - Build for production with TypeScript checks
- `bun run preview` - Preview production build

### Convex Backend
- `bunx convex dev` - Start Convex development backend (run in separate terminal)
- `bunx convex import --table tasks sampleData.jsonl` - Import sample data

### Code Quality
- Code formatting and linting via Biome (`@biomejs/biome`)
- TypeScript checking included in build process

## Architecture

### Data Flow (3-Layer Sync)
```
React Components ↔ TanStack DB ↔ RxDB ↔ Convex (via WebSocket streams)
     (UI)        (reactive)   (local)      (cloud)
```

1. **React → TanStack DB**: Components subscribe to reactive collections
2. **TanStack DB → RxDB**: Automatic persistence to local database
3. **RxDB ↔ Convex**: Bidirectional sync via WebSocket change streams

### Sync Engine Pattern (`src/sync/`)

The sync engine uses a **factory + hook pattern**:

#### Core Files
- `createConvexSync.ts` - Factory that creates table-specific sync instances
- `useConvexSync.ts` - Generic React hook providing CRUD operations for any synced table

#### Usage Pattern (see `src/useTasks.ts` for complete example)

```typescript
// 1. Define schema
const schema: RxJsonSchema<YourType> = { /* ... */ };

// 2. Create singleton sync instance
let syncInstance: Promise<any> | null = null;
async function getSyncInstance() {
  if (!syncInstance) {
    syncInstance = createConvexSync({
      tableName: 'yourTable',
      schema,
      convexApi: {
        changeStream: api.yourTable.changeStream,
        pullDocuments: api.yourTable.pullDocuments,
        pushDocuments: api.yourTable.pushDocuments
      }
    });
  }
  return syncInstance;
}

// 3. Create React hook using generic useConvexSync
export function useYourTable() {
  const [syncInstance, setSyncInstance] = React.useState(null);

  React.useEffect(() => {
    getSyncInstance().then(setSyncInstance);
  }, []);

  return useConvexSync<YourType>(syncInstance);
}
```

**Why singleton pattern?**: Prevents creating multiple database connections and replication states during React re-renders or hot module replacement in development.

### Required Convex Functions (per synced table)

Each synced table needs three functions (see `convex/tasks.ts`):

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

### Key Implementation Details

- **Conflict Resolution**: Server-wins strategy implemented in `pushDocuments`
- **WebSocket Change Detection**: Uses Convex `watchQuery()` to monitor `changeStream` query
- **Cross-tab Sync**: RxDB multiInstance mode enables automatic tab synchronization
- **Soft Deletes**: Items marked with `_deleted: true` instead of hard deletion
- **Hot Reload Safety**: Development mode uses `ignoreDuplicate` and cleanup on `beforeunload`

## File Structure

### Core Application
- `src/router.tsx` - TanStack Router setup with Convex client initialization
- `src/routes/` - File-based routing (TanStack Router convention)
- `rsbuild.config.ts` - Build configuration with TanStack Router plugin

### Example Implementation
- `src/useTasks.ts` - Complete example of sync hook with CRUD helpers
- `convex/tasks.ts` - Example Convex backend functions for tasks table
- `src/database.ts` - Legacy direct RxDB implementation (prior to abstraction)

### Sync Engine
- `src/sync/createConvexSync.ts` - Sync factory with RxDB + Convex setup
- `src/sync/useConvexSync.ts` - Generic React hook for any synced table

## Technology Stack

- **Build**: Rsbuild with React plugin and Rspack
- **Framework**: React 19
- **Routing**: TanStack Router (file-based)
- **State**: TanStack DB (reactive collections)
- **Local DB**: RxDB (LocalStorage storage)
- **Backend**: Convex (WebSocket + HTTP)
- **Styling**: Tailwind CSS 4.x
- **Language**: TypeScript (strict mode)
- **Runtime**: Bun

## Development Notes

- Dev server is manually managed - do not start via automated tools
- The sync engine is example code, not a published package
- All CRUD operations are optimistic with automatic background sync
- Logging can be controlled via `enableLogging` option in `createConvexSync`
