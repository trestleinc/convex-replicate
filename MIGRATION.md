# Migration Plan: Monorepo Refactor

**Status**: In Progress
**Started**: 2025-10-20
**Goal**: Extract core sync logic into framework-agnostic TypeScript package with React/Svelte adapters

---

## Overview

Refactor `convex-rx` from a single example project into a monorepo with:
- **Core package** (`@convex-rx/core`): Framework-agnostic RxDB + Convex sync engine
- **React package** (`@convex-rx/react`): React hooks + TanStack DB integration
- **Svelte package** (`@convex-rx/svelte`): Svelte stores integration
- **TanStack Start example**: Migrate from Rsbuild to Vite + TanStack Start
- **SvelteKit example**: New example demonstrating Svelte usage

### Current State
- Single React app using Rsbuild + TanStack Router
- Sync logic in `src/sync/` (370 lines in `createConvexSync.ts`, 217 lines in `useConvexRx.ts`)
- Hardcoded for React + TanStack DB

### Target State
- Monorepo with 3 packages + 2 examples
- Core logic framework-agnostic
- Examples demonstrating both React and Svelte usage

---

## Project Structure

```
convex-rx/
├── packages/
│   ├── core/                    # @convex-rx/core (private)
│   │   ├── src/
│   │   │   ├── index.ts        # Main exports
│   │   │   ├── sync.ts         # Core sync engine (~300 lines)
│   │   │   └── types.ts        # TypeScript types (~50 lines)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── react/                   # @convex-rx/react (private)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── useConvexRx.ts  # React hook (~200 lines)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── svelte/                  # @convex-rx/svelte (private)
│       ├── src/
│       │   ├── index.ts
│       │   └── stores.ts        # Svelte store (~150 lines)
│       ├── package.json
│       └── tsconfig.json
│
├── examples/
│   ├── tanstack-start/         # Migrated from current root
│   │   ├── app/                # Renamed from src/
│   │   ├── convex/             # Same backend
│   │   ├── public/
│   │   ├── package.json
│   │   ├── vite.config.ts      # Replaces rsbuild.config.ts
│   │   └── app.config.ts       # TanStack Start config
│   │
│   └── sveltekit/              # New example
│       ├── src/
│       │   ├── routes/
│       │   │   ├── +layout.svelte
│       │   │   └── +page.svelte
│       │   └── lib/
│       │       ├── convexClient.ts
│       │       └── stores/
│       │           └── tasks.ts
│       ├── convex/             # Copy of backend
│       ├── package.json
│       └── svelte.config.js
│
├── package.json                # Bun workspace root
├── tsconfig.base.json          # Shared TypeScript config
├── bunfig.toml                 # Bun configuration
└── MIGRATION.md                # This file
```

---

## Phase 1: Setup Monorepo ⏳ (30 min)

### Status: Not Started

### Tasks
- [ ] Create root `package.json` with Bun workspaces configuration
- [ ] Create `bunfig.toml` for Bun settings
- [ ] Create `tsconfig.base.json` with shared compiler options
- [ ] Create package directories: `packages/{core,react,svelte}/src`
- [ ] Create example directories: `examples/{tanstack-start,sveltekit}`
- [ ] Update `.gitignore` for monorepo structure

### Root package.json Template
```json
{
  "name": "convex-rx",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "packages/*",
    "examples/*"
  ],
  "scripts": {
    "build": "bun run build:core && bun run build:react && bun run build:svelte",
    "build:core": "cd packages/core && bun run build",
    "build:react": "cd packages/react && bun run build",
    "build:svelte": "cd packages/svelte && bun run build",
    "dev:tanstack": "cd examples/tanstack-start && bun run dev",
    "dev:svelte": "cd examples/sveltekit && bun run dev",
    "clean": "rm -rf packages/*/dist examples/*/dist"
  },
  "devDependencies": {
    "@biomejs/biome": "latest",
    "typescript": "latest"
  }
}
```

---

## Phase 2: Extract Core Package ⏳ (2-3 hours)

### Status: Not Started

### 2.1 Create Core Package Structure
- [ ] Create `packages/core/package.json` with dependencies
- [ ] Create `packages/core/tsconfig.json`
- [ ] Create `packages/core/src/` directory

### 2.2 Extract from `src/sync/createConvexSync.ts` → `packages/core/src/sync.ts`

#### What to Extract (Keep As-Is):
- [x] Import statements (update for core package)
- [x] `databaseInstances` Map (singleton management)
- [x] `getOrCreateDatabase()` function
- [x] `createBaseSchema()` function
- [x] `setupReplication()` function:
  - WebSocket change detection logic
  - Pull handler with checkpoint management
  - Push handler with conflict detection
  - Replication state monitoring
- [x] Main `createConvexRxSync()` function

#### What to Change:
- [ ] **Dependency Injection**: Accept `convexClient` as parameter instead of importing from `../router`
  ```typescript
  // OLD: import { convexClient } from '../router';
  // NEW: Accept as parameter
  export async function createConvexRxSync<T>({
    convexClient,  // INJECTED
    tableName,
    schema,
    convexApi,
    // ... other config
  }) { ... }
  ```

- [ ] **Remove TanStack DB Integration**: Delete these lines (~10 lines):
  ```typescript
  // DELETE:
  import { createCollection } from "@tanstack/react-db";
  import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection";

  // DELETE from return:
  const tanStackCollection = createCollection(
    rxdbCollectionOptions({ rxCollection, startSync: true })
  );
  ```

- [ ] **Update Return Type**: Return raw RxDB objects
  ```typescript
  return {
    rxDatabase: database,
    rxCollection,
    replicationState,
    tableName: config.tableName
  };
  ```

### 2.3 Create `packages/core/src/types.ts`
Move type definitions:
- [ ] `RxJsonSchema<T>` interface
- [ ] `ConvexSyncConfig<T>` interface

### 2.4 Create `packages/core/src/index.ts`
```typescript
export { createConvexRxSync } from './sync';
export type { ConvexSyncConfig, RxJsonSchema } from './types';
```

### 2.5 Create `packages/core/package.json`
```json
{
  "name": "@convex-rx/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "rxdb": "latest",
    "rxjs": "latest"
  },
  "peerDependencies": {
    "convex": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "latest"
  }
}
```

---

## Phase 3: Create React Package ⏳ (1-2 hours)

### Status: Not Started

### 3.1 Create React Package Structure
- [ ] Create `packages/react/package.json`
- [ ] Create `packages/react/tsconfig.json`
- [ ] Create `packages/react/src/` directory

### 3.2 Port `src/sync/useConvexRx.ts` → `packages/react/src/useConvexRx.ts`

#### What to Keep:
- [x] All React imports (`React.useState`, `React.useEffect`, etc.)
- [x] `SyncInstance` interface
- [x] `UseConvexRxActions` interface
- [x] `UseConvexRxResult` interface
- [x] `useConvexRx` hook implementation:
  - State management (data, isLoading, error)
  - Collection subscription logic
  - CRUD action methods (insert, update, delete)

#### What to Change:
- [ ] **Update Imports**: Import from `@convex-rx/core`
  ```typescript
  import { createConvexRxSync, type RxJsonSchema } from '@convex-rx/core';
  ```

- [ ] **Add TanStack DB Integration** (moved from core):
  ```typescript
  import { createCollection } from "@tanstack/react-db";
  import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection";

  // Inside useConvexRx hook:
  const collection = createCollection(
    rxdbCollectionOptions({
      rxCollection: syncInstance.rxCollection,
      startSync: true
    })
  );
  ```

### 3.3 Create `packages/react/src/index.ts`
```typescript
export { useConvexRx } from './useConvexRx';
export type {
  UseConvexRxResult,
  UseConvexRxActions
} from './useConvexRx';
```

### 3.4 Create `packages/react/package.json`
```json
{
  "name": "@convex-rx/react",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@convex-rx/core": "workspace:*",
    "@tanstack/rxdb-db-collection": "latest"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "@tanstack/react-db": "^0.1.0",
    "convex": "^1.0.0",
    "rxdb": "^16.0.0"
  },
  "devDependencies": {
    "@types/react": "latest",
    "typescript": "latest"
  }
}
```

---

## Phase 4: Create Svelte Package ⏳ (2-3 hours)

### Status: Not Started

### 4.1 Create Svelte Package Structure
- [ ] Create `packages/svelte/package.json`
- [ ] Create `packages/svelte/tsconfig.json`
- [ ] Create `packages/svelte/src/` directory

### 4.2 Create `packages/svelte/src/stores.ts` (New Implementation)

```typescript
import { writable, type Writable } from 'svelte/store';
import { createConvexRxSync, type ConvexSyncConfig } from '@convex-rx/core';
import type { Subscription } from 'rxjs';

interface ConvexStoreConfig<T> extends ConvexSyncConfig<T> {
  convexClient: any;
}

interface ConvexStore<T> extends Writable<T[]> {
  insert: (data: Omit<T, 'id' | 'updatedTime' | '_deleted'>) => Promise<string>;
  update: (id: string, updates: Partial<Omit<T, 'id' | 'updatedTime' | '_deleted'>>) => Promise<void>;
  delete: (id: string) => Promise<void>;
  isReady: () => boolean;
}

export function createConvexStore<T extends { id: string; updatedTime: number; _deleted?: boolean }>(
  config: ConvexStoreConfig<T>
): ConvexStore<T> {
  const { subscribe, set } = writable<T[]>([]);
  let syncInstance: any = null;
  let subscription: Subscription | null = null;
  let ready = false;

  // Initialize sync engine
  createConvexRxSync(config).then(instance => {
    syncInstance = instance;

    // Subscribe to RxDB changes
    subscription = instance.rxCollection.find().$.subscribe((docs: any[]) => {
      const activeItems = docs.filter(doc => !doc._deleted);
      set(activeItems);
      ready = true;
    });
  });

  return {
    subscribe,
    set,
    update: (updater) => {
      // Implement if needed
    },

    insert: async (data) => {
      if (!syncInstance) throw new Error('Store not initialized');

      const id = crypto.randomUUID();
      const item = {
        id,
        ...data,
        updatedTime: Date.now()
      } as any;

      await syncInstance.rxCollection.insert(item);
      return id;
    },

    update: async (id, updates) => {
      if (!syncInstance) throw new Error('Store not initialized');

      const doc = await syncInstance.rxCollection.findOne(id).exec();
      if (!doc) throw new Error(`Document ${id} not found`);

      await doc.update({
        $set: {
          ...updates,
          updatedTime: Date.now()
        }
      });
    },

    delete: async (id) => {
      if (!syncInstance) throw new Error('Store not initialized');

      const doc = await syncInstance.rxCollection.findOne(id).exec();
      if (!doc) throw new Error(`Document ${id} not found`);

      await doc.update({
        $set: {
          _deleted: true,
          updatedTime: Date.now()
        }
      });
    },

    isReady: () => ready
  };
}
```

### 4.3 Create `packages/svelte/src/index.ts`
```typescript
export { createConvexStore } from './stores';
export type { ConvexStore, ConvexStoreConfig } from './stores';
```

### 4.4 Create `packages/svelte/package.json`
```json
{
  "name": "@convex-rx/svelte",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "svelte": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "svelte": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@convex-rx/core": "workspace:*"
  },
  "peerDependencies": {
    "svelte": "^4.0.0 || ^5.0.0",
    "convex": "^1.0.0",
    "rxdb": "^16.0.0"
  },
  "devDependencies": {
    "svelte": "latest",
    "typescript": "latest"
  }
}
```

---

## Phase 5: Migrate to TanStack Start ⏳ (3-4 hours)

### Status: Not Started

### 5.1 Move Files to Example Directory
```bash
# Create example structure
mkdir -p examples/tanstack-start/{app,convex,public}

# Move current code
mv src/* examples/tanstack-start/app/
mv convex/* examples/tanstack-start/convex/
mv public/* examples/tanstack-start/public/
```

### 5.2 Create TanStack Start Configuration

#### `examples/tanstack-start/vite.config.ts`
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackStartVite } from '@tanstack/start/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';

export default defineConfig({
  plugins: [
    TanStackRouterVite(),
    TanStackStartVite(),
    react()
  ],
  resolve: {
    alias: {
      '@': './app'
    }
  }
});
```

#### `examples/tanstack-start/app.config.ts`
```typescript
import { defineConfig } from '@tanstack/start/config';

export default defineConfig({});
```

### 5.3 Update Package Dependencies

#### `examples/tanstack-start/package.json`
```json
{
  "name": "convex-rx-tanstack-start-example",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vinxi dev",
    "build": "vinxi build",
    "start": "vinxi start"
  },
  "dependencies": {
    "@convex-rx/react": "workspace:*",
    "@tanstack/react-router": "latest",
    "@tanstack/react-start": "latest",
    "@tanstack/start": "latest",
    "@tanstack/react-db": "latest",
    "convex": "latest",
    "react": "latest",
    "react-dom": "latest",
    "rxdb": "latest",
    "vinxi": "latest"
  },
  "devDependencies": {
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "@vitejs/plugin-react": "latest",
    "typescript": "latest",
    "vite": "latest"
  }
}
```

### 5.4 Update useTasks.ts
- [ ] Update imports to use `@convex-rx/react`:
  ```typescript
  // OLD
  import { createConvexSync, type RxJsonSchema } from "./sync/createConvexSync";
  import { useConvexRx } from "./sync/useConvexRx";

  // NEW
  import { useConvexRx } from '@convex-rx/react';
  import type { RxJsonSchema } from '@convex-rx/core';
  ```

- [ ] Update sync instance creation to pass `convexClient`:
  ```typescript
  // Inject convexClient from router
  import { convexClient } from '../router';

  const instance = await createConvexSync({
    convexClient,  // ADD THIS
    tableName: 'tasks',
    // ... rest of config
  });
  ```

### 5.5 Files to Update
- [ ] `app/useTasks.ts` - Update imports
- [ ] `app/router.tsx` - Ensure convexClient is exported
- [ ] `app/routes/*.tsx` - Update any direct imports

---

## Phase 6: Create SvelteKit Example ⏳ (3-4 hours)

### Status: Not Started

### 6.1 Bootstrap SvelteKit Project
```bash
cd examples/sveltekit
bun create svelte@latest . --template skeleton --types typescript
```

### 6.2 Install Dependencies

#### `examples/sveltekit/package.json`
```json
{
  "name": "convex-rx-sveltekit-example",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@convex-rx/svelte": "workspace:*",
    "convex": "latest",
    "rxdb": "latest"
  },
  "devDependencies": {
    "@sveltejs/adapter-auto": "latest",
    "@sveltejs/kit": "latest",
    "@sveltejs/vite-plugin-svelte": "latest",
    "svelte": "latest",
    "typescript": "latest",
    "vite": "latest"
  }
}
```

### 6.3 Setup Convex Client

#### `examples/sveltekit/src/lib/convexClient.ts`
```typescript
import { ConvexClient } from 'convex/browser';

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  throw new Error('VITE_CONVEX_URL environment variable is required');
}

export const convexClient = new ConvexClient(convexUrl);
```

### 6.4 Create Task Store

#### `examples/sveltekit/src/lib/stores/tasks.ts`
```typescript
import { createConvexStore } from '@convex-rx/svelte';
import { convexClient } from '../convexClient';
import { api } from '../../../convex/_generated/api';
import type { RxJsonSchema } from '@convex-rx/core';

type Task = {
  id: string;
  text: string;
  isCompleted: boolean;
  updatedTime: number;
  _deleted?: boolean;
};

const taskSchema: RxJsonSchema<Task> = {
  title: 'Task Schema',
  version: 0,
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: { type: 'string', maxLength: 100 },
    text: { type: 'string' },
    isCompleted: { type: 'boolean' },
    updatedTime: {
      type: 'number',
      minimum: 0,
      maximum: 8640000000000000,
      multipleOf: 1
    }
  },
  required: ['id', 'text', 'isCompleted', 'updatedTime'],
  indexes: [['updatedTime', 'id']]
};

export const tasks = createConvexStore<Task>({
  convexClient,
  tableName: 'tasks',
  schema: taskSchema,
  convexApi: {
    changeStream: api.tasks.changeStream,
    pullDocuments: api.tasks.pullDocuments,
    pushDocuments: api.tasks.pushDocuments
  },
  databaseName: 'tasksdb',
  batchSize: 100,
  retryTime: 5000,
  enableLogging: true
});
```

### 6.5 Create Layout

#### `examples/sveltekit/src/routes/+layout.svelte`
```svelte
<script lang="ts">
  import '../app.css';
</script>

<div class="container">
  <slot />
</div>
```

### 6.6 Create Task List Page

#### `examples/sveltekit/src/routes/+page.svelte`
```svelte
<script lang="ts">
  import { tasks } from '$lib/stores/tasks';

  let newTaskText = '';

  async function addTask() {
    if (!newTaskText.trim()) return;

    await tasks.insert({
      text: newTaskText,
      isCompleted: false
    });

    newTaskText = '';
  }

  async function toggleTask(id: string, isCompleted: boolean) {
    await tasks.update(id, { isCompleted: !isCompleted });
  }

  async function deleteTask(id: string) {
    await tasks.delete(id);
  }
</script>

<main>
  <h1>Tasks</h1>

  <form on:submit|preventDefault={addTask}>
    <input
      type="text"
      bind:value={newTaskText}
      placeholder="Add a new task..."
    />
    <button type="submit">Add</button>
  </form>

  {#if tasks.isReady()}
    <ul>
      {#each $tasks as task (task.id)}
        <li>
          <input
            type="checkbox"
            checked={task.isCompleted}
            on:change={() => toggleTask(task.id, task.isCompleted)}
          />
          <span class:completed={task.isCompleted}>
            {task.text}
          </span>
          <button on:click={() => deleteTask(task.id)}>Delete</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p>Loading tasks...</p>
  {/if}
</main>

<style>
  .completed {
    text-decoration: line-through;
    opacity: 0.6;
  }
</style>
```

### 6.7 Copy Convex Backend
- [ ] Copy `examples/tanstack-start/convex/` to `examples/sveltekit/convex/`
- [ ] Create `.env.local` with `VITE_CONVEX_URL`

---

## Phase 7: Update Documentation ⏳ (1 hour)

### Status: Not Started

### 7.1 Update Root README.md
- [ ] Add monorepo structure diagram
- [ ] Document workspace commands
- [ ] Add quick start for both examples
- [ ] Link to package READMEs

### 7.2 Create Package READMEs
- [ ] `packages/core/README.md` - Core API documentation
- [ ] `packages/react/README.md` - React hook usage
- [ ] `packages/svelte/README.md` - Svelte store usage

### 7.3 Update CLAUDE.md
- [ ] Document new workspace structure
- [ ] Update build commands
- [ ] Remove Rsbuild references
- [ ] Add TanStack Start + SvelteKit info

---

## Phase 8: Cleanup ⏳ (30 min)

### Status: Not Started

### Tasks
- [ ] Delete `src/sync/` directory (moved to packages)
- [ ] Delete `src/database.ts` (old implementation)
- [ ] Delete `rsbuild.config.ts` (replaced by vite.config.ts)
- [ ] Delete remaining `src/` files (moved to examples/tanstack-start/app/)
- [ ] Delete root `public/` directory (moved to example)
- [ ] Update `.gitignore`:
  - Add `packages/*/dist`
  - Add `examples/*/dist`
  - Add `examples/*/.env.local`
- [ ] Update `CLAUDE.md` with final structure
- [ ] Test all packages build successfully
- [ ] Test both examples run successfully

---

## Dependency Updates

Update all packages to latest versions:

### Core Dependencies
- `rxdb`: ^16.19.0 → `latest`
- `rxjs`: ^7.8.2 → `latest`
- `convex`: ^1.27.0 → `latest`

### React Dependencies
- `react`: ^19.1.1 → `latest`
- `@tanstack/react-db`: ^0.1.17 → `latest`
- `@tanstack/rxdb-db-collection`: ^0.1.6 → `latest`
- `@tanstack/react-router`: ^1.131.41 → `latest`
- `@tanstack/start`: Install `latest`

### Svelte Dependencies
- `svelte`: Install `latest` (^5.0.0)
- `@sveltejs/kit`: Install `latest`

### Dev Dependencies
- `typescript`: ^5.9.2 → `latest`
- `@biomejs/biome`: 2.2.4 → `latest`
- `vite`: Install `latest`

---

## What We're NOT Doing Yet

These features will be added incrementally after basic implementation:

- ❌ Multiple conflict resolution strategies (just server-wins for now)
- ❌ Multiple storage adapters (just LocalStorage)
- ❌ RxDB plugins (encryption, compression)
- ❌ Advanced monitoring/metrics
- ❌ Vue/Solid/Angular support
- ❌ npm publishing
- ❌ CI/CD setup
- ❌ Comprehensive test suite

---

## Success Criteria

The migration is complete when:

1. ✅ Core package builds successfully
2. ✅ React package builds successfully
3. ✅ Svelte package builds successfully
4. ✅ TanStack Start example runs and syncs tasks
5. ✅ SvelteKit example runs and syncs tasks
6. ✅ Cross-tab sync works in both examples
7. ✅ Offline mode works in both examples
8. ✅ All documentation is updated

---

## Rollback Plan

If migration fails, revert by:
1. Delete `packages/` directory
2. Delete `examples/` directory
3. Restore `src/sync/` from git history
4. Restore `rsbuild.config.ts`
5. Run `bun install` to restore dependencies

---

## Notes

- Keep commit history clean with logical, atomic commits
- Test each phase before moving to next
- Document any deviations from plan in this file
- Update timestamps as phases complete
