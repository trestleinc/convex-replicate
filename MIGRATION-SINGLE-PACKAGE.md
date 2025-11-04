# Migration to Single Package (@trestleinc/replicate)

## Summary

Successfully merged `@trestleinc/convex-replicate-component` and `@trestleinc/convex-replicate-core` into a single package `@trestleinc/replicate`, following the R2 component pattern.

## Changes Made

### New Package Structure

```
@trestleinc/replicate/
├── src/
│   ├── client/
│   │   ├── index.ts          # Main exports
│   │   ├── storage.ts        # ReplicateStorage class (from component)
│   │   ├── collection.ts     # TanStack DB integration (from core)
│   │   └── logger.ts         # LogTape utilities (from core)
│   ├── component/
│   │   ├── convex.config.ts  # Component definition
│   │   ├── schema.ts         # CRDT storage schema
│   │   └── public.ts         # Component API
│   └── server/
│       ├── replication.ts    # Server helpers (from core)
│       └── ssr.ts            # SSR utilities (from core)
├── rslib.config.ts           # Rslib build (replaced tsc)
├── package.json
├── tsconfig.json
└── README.md
```

### Build System

- **Switched from TypeScript compiler to Rslib** for all client/server code
- **Multiple entry points** configured via rslib.config.ts:
  - `.` - Main client export (storage + collection utilities)
  - `./replication` - Server-safe helpers
  - `./ssr` - SSR data loading
  - `./convex.config` - Component configuration

### Package Configuration

**Dependencies (bundled with package):**
- `yjs ^13.6.11` - CRDT engine (was peer dep, now bundled like R2 bundles AWS SDK)
- `@tanstack/offline-transactions ^0.1.0` - Outbox pattern
- `@logtape/logtape ^0.8.2` - Logging

**Peer Dependencies (user provides):**
- `convex ^1.28.0` - Convex platform
- `@tanstack/db ^0.4.17` - TanStack DB framework-agnostic core

### Package Exports

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "@convex-dev/component-source": "./src/client/index.ts"
    },
    "./replication": {
      "import": "./dist/replication.js"
    },
    "./ssr": {
      "import": "./dist/ssr.js"
    },
    "./convex.config": {
      "import": "./dist/component/convex.config.js",
      "@convex-dev/component-source": "./src/component/convex.config.ts"
    }
  }
}
```

## Migration Guide for Users

### Before (Two Packages)

**Installation:**
```bash
npm install @trestleinc/convex-replicate-component @trestleinc/convex-replicate-core yjs @tanstack/offline-transactions
```

**Imports:**
```typescript
// Component config
import replicate from '@trestleinc/convex-replicate-component/convex.config';

// Client utilities
import { createConvexCollection } from '@trestleinc/convex-replicate-core';

// Server helpers
import { insertDocumentHelper } from '@trestleinc/convex-replicate-core/replication';
```

### After (Single Package)

**Installation:**
```bash
npm install @trestleinc/replicate
```

**Imports:**
```typescript
// Component config
import replicate from '@trestleinc/replicate/convex.config';

// Client utilities
import { createConvexCollection } from '@trestleinc/replicate';

// Server helpers
import { insertDocumentHelper } from '@trestleinc/replicate/replication';
```

## Benefits

✅ **Single package** - Users install one package instead of two  
✅ **Simpler naming** - `@trestleinc/replicate` (not "convex-replicate")  
✅ **Rslib build system** - Faster builds, better optimization than tsc  
✅ **Bundle Yjs** - Like R2 bundles AWS SDK (eliminates peer dep confusion)  
✅ **Matches R2 pattern** - Proven structure from Convex team  
✅ **No framework hooks needed** - TanStack DB provides them (better abstraction)  

## Updated Examples

Both examples updated to use the new package:
- `examples/tanstack-start/` - ✅ Updated
- `examples/sveltekit/` - ✅ Updated

## Build Verification

```bash
$ bun run build
✓ packages/replicate built successfully
  - dist/index.js (11.7 KB)
  - dist/replication.js (2.4 KB)
  - dist/ssr.js (0.51 KB)
  - dist/component/convex.config.js (0.14 KB)

$ bun run typecheck
✓ No type errors

$ cd examples/tanstack-start && bun run check
✓ Checked 17 files - No fixes needed
```

## Old Packages (To Be Deprecated)

The following packages can now be deprecated/archived:
- `packages/component/` - Merged into `packages/replicate/`
- `packages/core/` - Merged into `packages/replicate/`

## Next Steps

1. ✅ New package created and building
2. ✅ Examples updated and verified
3. ✅ Root workspace scripts updated
4. 🔲 Update documentation to reference `@trestleinc/replicate`
5. 🔲 Publish `@trestleinc/replicate@0.3.0`
6. 🔲 Deprecate old packages (`@trestleinc/convex-replicate-*`)
7. 🔲 Archive `packages/r2/` (reference clone, no longer needed)

## Design Philosophy

Following the R2 component pattern, we realized:

1. **No React/Svelte hooks needed** - TanStack DB already provides `useLiveQuery` and other framework hooks. Users just pass the collection to them.

2. **Bundle core dependencies** - Yjs and offline-transactions are bundled (like R2 bundles AWS SDK), making installation simpler.

3. **Framework-agnostic by design** - The collection wrapper is framework-agnostic. Framework integration comes from TanStack DB, not from our package.

This creates a **better abstraction** than R2's framework-specific hooks:

```typescript
// R2 pattern (framework-specific hooks)
const uploadFile = useUploadFile(api.r2);

// Our pattern (framework-agnostic, cleaner)
const collection = createConvexCollection(...);
const { data } = useLiveQuery(collection); // TanStack provides the hook!
```

Users get framework integration **for free** from TanStack DB. We just provide the collection wrapper. Beautiful! 🎯
