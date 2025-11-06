# Implementation Plan: v0.3.0 - Delta Event Sourcing + Hard Deletes

**Status:** Ready for Implementation  
**Version:** v0.3.0 (First Release)  
**Focus:** Core functionality - Delete support + Delta event sourcing  
**Scope:** NO UI recovery features (future work)

---

## 🎯 Overview

Implement delta event sourcing architecture with hard delete support. This is the foundational release - focuses on core CRDT infrastructure, not user-facing recovery UI.

### Key Changes

1. **Component Storage** → Append-only event log (multiple versions per document)
2. **Client Handlers** → Add `onDelete` handler (currently missing)
3. **Subscription** → Detect hard deletes from main table
4. **Server Helpers** → Hard delete from main table, preserve CRDT history
5. **Component API** → All mutations append (no patching/hard deletes)

### Out of Scope (Future)

- ❌ Recovery UI components
- ❌ Time-travel UI
- ❌ Audit trail visualization
- ❌ Admin panels

---

## 📐 Architecture Constraints

### ✅ What Works

- **Yjs on CLIENT only** - Browser-side CRDT processing
- **Convex on SERVER** - Database operations, raw bytes only
- **No Yjs on Convex** - Sandbox doesn't support it

### Component Boundary

```
┌─────────────────────────────────────────────────┐
│ CLIENT (Browser)                                 │
│ - Yjs Y.Doc, Y.Map                              │
│ - Delta capture/merge                           │
│ - CRDT conflict resolution                      │
└─────────────────────────────────────────────────┘
                      ↕ CRDT Bytes (ArrayBuffer)
┌─────────────────────────────────────────────────┐
│ SERVER (Convex)                                  │
│ - Store/retrieve raw bytes                      │
│ - Database queries                              │
│ - NO Yjs processing                             │
└─────────────────────────────────────────────────┘
```

---

## 📋 Implementation Phases

---

## PHASE 1: Component Schema Migration

### File: `packages/replicate/src/component/schema.ts`

**Change:** Enable append-only event log

```typescript
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  documents: defineTable({
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),           // Delta update (not full state)
    version: v.number(),             // Sequence number
    timestamp: v.number(),
    operationType: v.string(),       // 'insert' | 'update' | 'delete'
  })
    .index('by_collection', ['collectionName'])
    .index('by_collection_document_version', [  // ✅ CHANGED: Allows multiple versions
      'collectionName',
      'documentId',
      'version'
    ])
    .index('by_timestamp', ['collectionName', 'timestamp'])
});
```

**Key Changes:**
- ✅ Add `operationType` field
- ✅ Change index from `by_collection_document` to `by_collection_document_version`
- ✅ Allows multiple records per document (event sourcing)

---

## PHASE 2: Component API Refactor

### File: `packages/replicate/src/component/public.ts`

### 2.1 Update `insertDocument` - Remove Duplicate Check

**Current Problem:** Lines 23-34 prevent event sourcing

```typescript
// ❌ REMOVE THIS:
const existing = await ctx.db
  .query('documents')
  .withIndex('by_collection_document', ...)
  .first();

if (existing) {
  throw new Error('Document already exists');
}
```

**New Implementation:**

```typescript
export const insertDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // ✅ APPEND delta (no duplicate check!)
    await ctx.db.insert('documents', {
      collectionName: args.collectionName,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
      operationType: 'insert',  // ✅ NEW
    });

    return { success: true };
  },
});
```

### 2.2 Update `updateDocument` - Append Instead of Patch

**Current Problem:** Line 80 replaces delta

```typescript
// ❌ REMOVE THIS:
await ctx.db.patch(existing._id, {
  crdtBytes: args.crdtBytes,  // Overwrites history!
  version: args.version,
  timestamp: Date.now(),
});
```

**New Implementation:**

```typescript
export const updateDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // ✅ APPEND new version (don't patch!)
    await ctx.db.insert('documents', {
      collectionName: args.collectionName,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
      operationType: 'update',  // ✅ NEW
    });

    return { success: true };
  },
});
```

### 2.3 Update `deleteDocument` - Append Deletion Delta

**Current Problem:** Line 113 destroys history

```typescript
// ❌ REMOVE THIS:
if (doc) {
  await ctx.db.delete(doc._id);  // Permanent deletion!
}
```

**New Implementation:**

```typescript
export const deleteDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),      // ✅ NEW: Deletion delta required
    version: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // ✅ APPEND deletion delta (preserve history!)
    await ctx.db.insert('documents', {
      collectionName: args.collectionName,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
      operationType: 'delete',  // ✅ NEW
    });

    return { success: true };
  },
});
```

### 2.4 NEW: Add `getDocumentHistory` Query

**Purpose:** Fetch all deltas for a document (for future recovery)

```typescript
/**
 * Get complete event history for a document.
 * Returns all CRDT deltas in chronological order.
 * 
 * Used for:
 * - Future recovery features (client-side)
 * - Audit trails
 * - Debugging
 */
export const getDocumentHistory = query({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
  },
  returns: v.array(v.object({
    crdtBytes: v.bytes(),
    version: v.number(),
    timestamp: v.number(),
    operationType: v.string(),
  })),
  handler: async (ctx, args) => {
    // Fetch ALL deltas for this document
    const deltas = await ctx.db
      .query('documents')
      .withIndex('by_collection_document_version', (q) =>
        q.eq('collectionName', args.collectionName)
         .eq('documentId', args.documentId)
      )
      .order('asc')  // Chronological order
      .collect();

    return deltas.map(d => ({
      crdtBytes: d.crdtBytes,
      version: d.version,
      timestamp: d.timestamp,
      operationType: d.operationType,
    }));
  },
});
```

---

## PHASE 3: Client-Side Changes

### File: `packages/replicate/src/client/collection.ts`

### 3.1 ADD `onDelete` Handler (Currently Missing!)

**Location:** After `onUpdate` handler (after line 235)

```typescript
// ✅ NEW: onDelete handler (called when user does collection.delete())
onDelete: async ({ transaction }: any) => {
  logger.debug('onDelete handler called', {
    collectionName,
    mutationCount: transaction.mutations.length,
  });

  try {
    // Remove from Yjs Y.Map - creates deletion tombstone
    ydoc.transact(() => {
      transaction.mutations.forEach((mut: any) => {
        ymap.delete(String(mut.key));  // Yjs creates delete delta
      });
    }, 'delete');

    // Send deletion DELTA to Convex
    if (pendingUpdate) {
      logger.debug('Sending delete delta to Convex', {
        collectionName,
        documentId: String(transaction.mutations[0].key),
        deltaSize: pendingUpdate.length,
      });

      await convexClient.mutation(api.deleteDocument, {
        collectionName,
        documentId: String(transaction.mutations[0].key),
        crdtBytes: pendingUpdate.buffer,  // Deletion delta!
        version: Date.now(),
      });

      pendingUpdate = null;
      logger.info('Delete persisted to Convex', {
        collectionName,
        documentId: String(transaction.mutations[0].key),
      });
    }
  } catch (error: any) {
    logger.error('Delete failed', {
      collectionName,
      error: error?.message,
      status: error?.status,
    });

    if (error?.status === 401 || error?.status === 403) {
      throw new NonRetriableError('Authentication failed');
    }
    if (error?.status === 422) {
      throw new NonRetriableError('Validation error');
    }

    throw error;
  }
},
```

### 3.2 UPDATE Subscription - Detect Hard Deletes

**Location:** Replace subscription logic in `sync` function (lines 271-320)

```typescript
// Step 2: Subscribe to Convex real-time updates via main table
logger.debug('Setting up Convex subscription', { collectionName });

// ✅ NEW: Track previous doc IDs to detect deletions
let previousDocIds = new Set<string>();

const subscription = convexClient.onUpdate(api.stream, {}, async (items) => {
  try {
    logger.debug('Subscription update received', {
      collectionName,
      itemCount: items.length,
    });

    // ✅ NEW: Detect hard deletes
    const currentDocIds = new Set(items.map(item => getKey(item as T)));
    const deletedIds = [...previousDocIds].filter(id => !currentDocIds.has(id));

    if (deletedIds.length > 0) {
      logger.info('Detected remote hard deletes', {
        collectionName,
        deletedCount: deletedIds.length,
        deletedIds,
      });
    }

    begin();

    // STEP 1: Handle deletions FIRST
    for (const deletedId of deletedIds) {
      // Remove from Yjs
      ydoc.transact(() => {
        ymap.delete(String(deletedId));
      }, 'remote-delete');

      // Remove from TanStack DB
      write({ type: 'delete', key: deletedId });
    }

    // STEP 2: Sync items to Yjs
    ydoc.transact(() => {
      for (const item of items) {
        const key = getKey(item as T);
        const itemYMap = new Y.Map();
        Object.entries(item as Record<string, unknown>).forEach(([k, v]) => {
          itemYMap.set(k, v);
        });
        ymap.set(String(key), itemYMap);
      }
    }, 'subscription-sync');

    // STEP 3: Sync items to TanStack DB
    for (const item of items) {
      const key = getKey(item as T);

      if ((params as any).collection.has(key)) {
        write({ type: 'update', value: item as T });
      } else {
        write({ type: 'insert', value: item as T });
      }
    }

    commit();

    // ✅ Update tracking
    previousDocIds = currentDocIds;

    logger.debug('Successfully synced items to collection', {
      count: items.length,
      deletedCount: deletedIds.length,
    });
  } catch (error: any) {
    logger.error('Failed to sync items from subscription', {
      error: error.message,
      stack: error?.stack?.split('\n')[0],
    });
  }
});

markReady();

// Return cleanup function
return () => {
  logger.debug('Cleaning up Convex subscription', { collectionName });
  subscription();
};
```

---

## PHASE 4: Server Replication Helpers

### File: `packages/replicate/src/server/replication.ts`

### 4.1 UPDATE `insertDocumentHelper` - Remove `deleted` Field

**Location:** Line 72

```typescript
// BEFORE:
await db.insert(tableName, {
  id: args.id,
  ...cleanDoc,
  version: args.version,
  timestamp,
  deleted: false,  // ❌ REMOVE
});

// AFTER:
await db.insert(tableName, {
  id: args.id,
  ...cleanDoc,
  version: args.version,
  timestamp,
  // No deleted field!
});
```

### 4.2 UPDATE `updateDocumentHelper` - Remove `deleted` Field Handling

**Location:** Lines 132-138

```typescript
// Just patch normally - no deleted field logic
await db.patch(existing._id, {
  ...cleanDoc,
  version: args.version,
  timestamp,
});
```

### 4.3 UPDATE `deleteDocumentHelper` - Hard Delete

**Location:** Replace entire function (lines 173-229)

```typescript
/**
 * HARD delete a document from main table, APPEND deletion delta to component.
 *
 * NEW BEHAVIOR (v0.3.0):
 * - Appends deletion delta to component event log (preserves history)
 * - Physically removes document from main table (hard delete)
 * - CRDT history preserved for future recovery features
 *
 * @param ctx - Convex mutation context
 * @param components - Generated components from Convex
 * @param tableName - Name of the main application table
 * @param args - Document data with id, crdtBytes (deletion delta), and version
 * @returns Success indicator with metadata
 */
export async function deleteDocumentHelper<_DataModel extends GenericDataModel>(
  ctx: unknown,
  components: unknown,
  tableName: string,
  args: { id: string; crdtBytes: ArrayBuffer; version: number }
): Promise<{
  success: boolean;
  metadata: {
    documentId: string;
    timestamp: number;
    version: number;
    collectionName: string;
  };
}> {
  const timestamp = Date.now();

  // 1. Append deletion delta to component (event log)
  await (ctx as any).runMutation((components as any).replicate.public.deleteDocument, {
    collectionName: tableName,
    documentId: args.id,
    crdtBytes: args.crdtBytes,  // Deletion delta from Yjs
    version: args.version,
  });

  // 2. HARD DELETE from main table (physical removal)
  const db = (ctx as any).db;
  const existing = await db
    .query(tableName)
    .withIndex('by_user_id', (q: unknown) => (q as any).eq('id', args.id))
    .first();

  if (existing) {
    await db.delete(existing._id);  // ✅ Physical deletion!
  }

  return {
    success: true,
    metadata: {
      documentId: args.id,
      timestamp,
      version: args.version,
      collectionName: tableName,
    },
  };
}
```

**Note:** Update existing comment documentation (lines 152-172) to reflect hard delete behavior.

---

## PHASE 5: Update Server Schema Helper

### File: `packages/replicate/src/server/schema.ts`

### Update `replicatedTable` Documentation

**Location:** Lines 35-51 (update comments)

```typescript
/**
 * Create a replicated table schema with required fields for CRDT synchronization.
 *
 * Automatically adds these fields to your schema:
 * - `version` - CRDT version number for conflict detection
 * - `timestamp` - Last modification timestamp
 *
 * These fields enable:
 * - Dual-storage architecture (CRDT component + main table)
 * - Conflict-free replication across clients
 * - Hard delete support with CRDT history preservation
 * - Event sourcing via component storage
 *
 * @example
 * ```typescript
 * export default defineSchema({
 *   tasks: replicatedTable({
 *     id: v.string(),
 *     text: v.string(),
 *     isCompleted: v.boolean(),
 *     // NO deleted field needed!
 *   }, (table) => table.index('by_user_id', ['id']))
 * });
 * ```
 */
```

**Remove references to `deleted` and `deletedAt` fields.**

---

## PHASE 6: Update Examples

### File: `examples/tanstack-start/convex/schema.ts`

```typescript
import { defineSchema } from 'convex/server';
import { v } from 'convex/values';
import { replicatedTable } from '@trestleinc/replicate/server';

export default defineSchema({
  tasks: replicatedTable(
    {
      id: v.string(),
      text: v.string(),
      isCompleted: v.boolean(),
      // ✅ NO deleted field!
      // ✅ NO deletedAt field!
    },
    (table) => table.index('by_user_id', ['id']).index('by_timestamp', ['timestamp'])
  ),
});
```

### File: `examples/tanstack-start/src/routes/index.tsx`

**Update delete handler:**

```typescript
// BEFORE (soft delete):
const handleDelete = (id: string) => {
  collection.update(id, (draft: any) => {
    draft.deleted = true;  // ❌ OLD PATTERN
  });
};

// AFTER (hard delete):
const handleDelete = (id: string) => {
  collection.delete(id);  // ✅ NEW PATTERN
};
```

**Remove filtering:**

```typescript
// BEFORE:
const { data: allTasks } = useLiveQuery(collection);
const tasks = allTasks?.filter((task: any) => !task.deleted) || [];

// AFTER:
const { data: tasks } = useLiveQuery(collection);
// No filtering needed!
```

**Update SSR loader:**

```typescript
// BEFORE:
export const Route = createFileRoute('/')({
  loader: async () => {
    const httpClient = new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL);
    const allTasks = await httpClient.query(api.tasks.stream);
    const tasks = allTasks.filter((task: any) => !task.deleted);  // ❌ REMOVE
    return { tasks };
  },
});

// AFTER:
export const Route = createFileRoute('/')({
  loader: async () => {
    const httpClient = new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL);
    const tasks = await httpClient.query(api.tasks.stream);
    return { tasks };  // No filtering!
  },
});
```

---

## PHASE 7: Update Documentation

### File: `README.md`

**Add section on hard deletes:**

```markdown
## Delete Pattern: Hard Delete with CRDT History

ConvexReplicate uses **hard deletes** where items are physically removed from the main table, while the CRDT event log preserves complete history for recovery and auditing.

### How It Works

```typescript
// Client-side: Simple delete
const handleDelete = (id: string) => {
  collection.delete(id);  // Triggers onDelete handler
};

// Behind the scenes:
// 1. Yjs creates deletion delta (tombstone)
// 2. Delta sent to server (component event log)
// 3. Main table: physical deletion
// 4. Other clients notified via subscription
// 5. CRDT history preserved in component storage
```

### Benefits

- ✅ Clean main table (no filtering needed)
- ✅ Complete audit trail (CRDT event log)
- ✅ Proper CRDT conflict resolution
- ✅ Multi-client sync works perfectly
- ✅ Future recovery features possible

### Key Concepts

**Dual Storage:**
- **Component Storage:** Append-only CRDT event log (all deltas preserved)
- **Main Table:** Current state only (hard deletes allowed)

**Event Sourcing:**
Each mutation (insert/update/delete) appends a delta to the component event log. This enables:
- Complete audit trail
- Point-in-time reconstruction (future)
- Conflict-free replication
```

### File: `CHANGELOG.md`

```markdown
## v0.3.0 (Upcoming)

### Features

- **Delta Event Sourcing:** Component storage now uses append-only event log
- **Hard Deletes:** Documents physically removed from main table
- **Delete Handler:** Added `onDelete` handler for TanStack DB integration
- **Subscription Hard Delete Detection:** Automatically detects and propagates deletions
- **Event History API:** Added `getDocumentHistory` query for future recovery features

### Breaking Changes

- **Schema Change:** Component storage now allows multiple versions per document
- **Delete Pattern:** Changed from soft delete (`deleted: true`) to hard delete
- **No `deleted` Field:** Remove `deleted` and `deletedAt` fields from main table schemas
- **Delete Mutation Args:** `deleteDocument` now requires `crdtBytes` parameter

### Migration Guide

**Update Schemas:**
```typescript
// Remove these fields:
// deleted: v.boolean()
// deletedAt: v.number()
```

**Update Delete Handlers:**
```typescript
// OLD:
collection.update(id, draft => { draft.deleted = true })

// NEW:
collection.delete(id)
```

**Remove UI Filtering:**
```typescript
// No longer needed:
// const tasks = allTasks.filter(t => !t.deleted)
```

### Internal Changes

- Component API mutations now append instead of patch/replace
- Subscription tracks previous doc IDs to detect deletions
- Server helpers perform hard deletes on main table
```

---

## 🧪 Testing Checklist

### Unit Tests

- [ ] `onDelete` handler captures Yjs deletion delta
- [ ] Subscription detects hard deletes correctly
- [ ] Component mutations append (not patch/replace)
- [ ] Multiple versions per document allowed

### Integration Tests

- [ ] Delete propagates to all connected clients
- [ ] Concurrent deletes handled correctly
- [ ] Delete + recreate same ID works
- [ ] Offline delete syncs when reconnected

### Edge Cases

- [ ] Delete non-existent document (no-op)
- [ ] Delete then recreate same ID
- [ ] Two clients delete same document concurrently
- [ ] Offline delete + online edit conflict resolution

### Example App Tests

- [ ] Delete button works
- [ ] Deleted tasks disappear from UI
- [ ] No `deleted` field filtering needed
- [ ] SSR loads correct data (no deleted items)

---

## 📅 Implementation Timeline

### Week 1: Core Changes
- **Day 1:** Component schema + API refactor (PHASE 1-2)
- **Day 2:** Client onDelete handler (PHASE 3.1)
- **Day 3:** Subscription hard delete detection (PHASE 3.2)
- **Day 4:** Server replication helpers (PHASE 4)
- **Day 5:** Testing + bug fixes

### Week 2: Examples & Documentation
- **Day 1:** Update example apps (PHASE 6)
- **Day 2:** Update documentation (PHASE 7)
- **Day 3:** Integration testing
- **Day 4:** Final polish + PR review
- **Day 5:** Release v0.3.0 🎉

---

## ✅ Success Criteria

- [ ] All component mutations append to event log
- [ ] `onDelete` handler implemented and working
- [ ] Subscription detects and propagates hard deletes
- [ ] Main table uses hard deletes (no `deleted` field)
- [ ] CRDT history preserved in component storage
- [ ] Example apps updated and working
- [ ] Documentation complete and accurate
- [ ] All tests passing

---

## 🚫 Out of Scope (Future Work)

These features are NOT part of v0.3.0:

- ❌ Recovery UI components
- ❌ Time-travel UI
- ❌ Audit trail visualization
- ❌ Admin panels for viewing history
- ❌ Client-side recovery utilities (foundation exists via `getDocumentHistory`)

**Rationale:** Focus on core infrastructure first. UI features can be built on top of the event sourcing foundation in future releases.

---

## 📝 Notes

- No migration needed (first release)
- Yjs only runs on client (never on Convex server)
- Recovery possible via `getDocumentHistory` + client-side Yjs (future)
- Event sourcing enables many future features (audit, time-travel, etc.)
