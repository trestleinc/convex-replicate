# Migration Guide: v0.1.x → v0.2.0

## Breaking Changes: Consistent Naming

Version 0.2.0 introduces a comprehensive naming consistency refactor. All public APIs have been renamed to remove redundant "Replicate" and "Automerge" suffixes, since the package scope already indicates this is `@trestleinc/convex-replicate-*`.

## Quick Migration

### Core Package (`@trestleinc/convex-replicate-core`)

| Old Name (v0.1.x) | New Name (v0.2.0) |
|-------------------|-------------------|
| `convexAutomergeCollectionOptions` | `convexCollectionOptions` |
| `ConvexReplicateCollection` | `ConvexCollection` |
| `getConvexReplicateLogger` | `getLogger` |

### Component Package (`@trestleinc/convex-replicate-component`)

| Old Name (v0.1.x) | New Name (v0.2.0) |
|-------------------|-------------------|
| `ConvexReplicateStorage` | `ReplicateStorage` |

## Code Examples

### Before (v0.1.x)

```typescript
// Core package
import { 
  convexAutomergeCollectionOptions,
  getConvexReplicateLogger,
  type ConvexReplicateCollection 
} from '@trestleinc/convex-replicate-core';

const logger = getConvexReplicateLogger(['app']);
let tasksCollection: ConvexReplicateCollection<Task> | undefined;

createCollection(
  convexAutomergeCollectionOptions<Task>({
    convexClient,
    api: api.tasks,
    collectionName: 'tasks',
    getKey: (task) => task.id,
  })
);

// Component package
import { ConvexReplicateStorage } from '@trestleinc/convex-replicate-component';

const storage = new ConvexReplicateStorage(components.replicate, 'tasks');
```

### After (v0.2.0)

```typescript
// Core package
import { 
  convexCollectionOptions,
  getLogger,
  type ConvexCollection 
} from '@trestleinc/convex-replicate-core';

const logger = getLogger(['app']);
let tasksCollection: ConvexCollection<Task> | undefined;

createCollection(
  convexCollectionOptions<Task>({
    convexClient,
    api: api.tasks,
    collectionName: 'tasks',
    getKey: (task) => task.id,
  })
);

// Component package
import { ReplicateStorage } from '@trestleinc/convex-replicate-component';

const storage = new ReplicateStorage(components.replicate, 'tasks');
```

## Find & Replace Guide

If you're using a code editor with find-and-replace across files:

1. **Core Package Imports:**
   - Find: `convexAutomergeCollectionOptions`
   - Replace: `convexCollectionOptions`

   - Find: `ConvexReplicateCollection`
   - Replace: `ConvexCollection`

   - Find: `getConvexReplicateLogger`
   - Replace: `getLogger`

2. **Component Package Imports:**
   - Find: `ConvexReplicateStorage`
   - Replace: `ReplicateStorage`

3. **Import Statements:**
   - Find: `@convex-replicate/component`
   - Replace: `@trestleinc/convex-replicate-component`

   - Find: `@convex-replicate/core`
   - Replace: `@trestleinc/convex-replicate-core`

## Why This Change?

### Problems with v0.1.x

- **Inconsistent**: Mixed use of "Replicate" and "Automerge" in naming
- **Redundant**: Package name already says `convex-replicate`, repeating it in every export is verbose
- **Implementation details**: "Automerge" is an implementation detail users don't need to know about

### Benefits of v0.2.0

- **Cleaner API**: Shorter, more memorable names
- **Consistent**: All exports follow the same `Convex*` pattern
- **Professional**: Matches naming conventions of popular libraries (e.g., TanStack Query uses `useQuery`, not `useTanStackQuery`)
- **Better DX**: Less typing, easier to remember

## Impact

This is a **breaking change** affecting all public APIs. All existing code using v0.1.x will need to be updated to work with v0.2.0.

## Need Help?

If you encounter issues during migration, please open an issue at:
https://github.com/trestleinc/convex-replicate/issues
