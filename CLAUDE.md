# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **monorepo** containing reusable packages for offline-first sync architecture using:
- **RxDB** - Local database with offline storage
- **Convex** - Real-time cloud database with WebSocket streaming
- **RxJS** - Reactive programming primitives

The main package `@convex-rx/core` provides a sync engine that bridges RxDB and Convex for bidirectional real-time synchronization.

## Monorepo Structure

```
convex-rx/
├── packages/
│   └── core/          # @convex-rx/core - Core sync engine
├── biome.json         # Root Biome configuration
├── tsconfig.base.json # Shared TypeScript configuration
└── bunfig.toml        # Bun workspace configuration
```

## Commands

### Build & Development
- `bun run build` - Build all packages (currently just core)
- `bun run typecheck` - Type check all packages
- `bun run clean` - Remove all build artifacts

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

### Core Package (`packages/core/`)
- `src/index.ts` - Main package exports
- `src/sync.ts` - Sync factory implementation (createConvexSync)
- `src/types.ts` - TypeScript type definitions
- `package.json` - Package configuration with peer dependencies
- `tsconfig.json` - TypeScript configuration extending base

## Technology Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Bun
- **Code Quality**: Biome v2 (linting + formatting)
- **Database**: RxDB (local) + Convex (cloud)
- **Reactivity**: RxJS

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

- Use `bun run check:fix` before committing to ensure code quality
- All packages share the same Biome and TypeScript configuration from the root
- Workspace dependencies use `workspace:*` protocol in package.json
- Type checking runs against all packages simultaneously
