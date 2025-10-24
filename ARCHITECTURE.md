# convex-replicate Architecture

**Complete system design for client-side CRDT + Convex storage + TanStack DB reactivity**

**Date:** 2025-10-23
**Status:** Design Complete - Ready for Implementation

---

## Table of Contents

1. [Overview & Philosophy](#overview--philosophy)
2. [System Architecture](#system-architecture)
3. [Package Structure](#package-structure)
4. [Data Flow](#data-flow)
5. [Client-Side CRDT Layer](#client-side-crdt-layer)
6. [Convex Storage Component](#convex-storage-component)
7. [TanStack DB Integration](#tanstack-db-integration)
8. [Developer Experience](#developer-experience)
9. [API Reference](#api-reference)
10. [Implementation Roadmap](#implementation-roadmap)

---

## Overview & Philosophy

### What is convex-replicate?

A local-first sync library that combines:
- **Automerge** (CRDT) for conflict-free merging - runs client-side
- **TanStack DB** for reactive queries and UI state management
- **Convex Component** for cloud storage (CRDT-aware but implementation-agnostic)
- **IndexedDBStorageAdapter** for local persistence

### Core Principles

**1. Client-First Architecture**
- All CRDT operations (merge, change) happen client-side
- Server is a "dumb pipe" for binary blob storage
- No Convex runtime constraints (no WASM loading, no cold starts)

**2. CRDT-Native**
- Automatic conflict resolution via Automerge.merge()
- No manual conflict handlers needed
- Eliminates 300+ lines of conflict resolution code from convex-rx

**3. Framework-Agnostic Core**
- Core package works with any JS framework
- React wrapper provided
- Future: Svelte, Vue, Solid wrappers

**4. Component-Based**
- Convex Component is reusable across projects
- No function builder needed (unlike RxDB approach)
- Just install and reference `api.storage.*`

### Why This Architecture?

**Problem with RxDB (old approach):**
```
TanStack DB → RxDB → Storage → Convex
```
- Too many layers
- RxDB adds complexity without benefit
- Custom conflict handlers work around RxDB's half-baked CRDT support
- 719 lines of unnecessary code

**New approach:**
```
TanStack DB → Automerge (client) → Storage → Convex
```
- Direct Automerge integration
- Fewer layers, cleaner code
- True CRDT conflict resolution
- Convex Component isolates storage logic

**Why client-side CRDT?**

Based on [Stack article](https://stack.convex.dev/automerge-and-convex) and Convex runtime research:
1. **No runtime constraints**: Automerge requires WASM, which adds 200ms overhead in Convex's V8 runtime
2. **Node actions only**: Can only use Automerge in actions (not queries/mutations)
3. **Best practice**: "If your clients are trusted to maintain data validity, it's simpler to do the Automerge operations client-side"
4. **Performance**: Client CPU is free, server CPU costs money

---

## System Architecture

### Complete Stack

```
┌─────────────────────────────────────────────────────────┐
│           React Component (UI Layer)                    │
│                                                          │
│   const { data, actions } = useConvexReplicate({       │
│     collectionName: 'tasks'                            │
│   })                                                    │
└───────────────────────┬─────────────────────────────────┘
                        │ useLiveQuery()
┌───────────────────────▼─────────────────────────────────┐
│     TanStack DB Collection (Reactive State)             │
│             @convex-replicate/react                     │
│                                                          │
│  • collection.toArray() - Get current data             │
│  • useLiveQuery() - Subscribe to changes               │
│  • Handles deduplication & state mgmt                  │
└───────────────────────┬─────────────────────────────────┘
                        │ sync function
┌───────────────────────▼─────────────────────────────────┐
│   AutomergeDocumentStore (CRDT Operations)              │
│             @convex-replicate/core                      │
│                                                          │
│  • Map<id, Automerge.Doc<T>> - In-memory docs          │
│  • Automerge.change() - Local updates                  │
│  • Automerge.merge() - Merge remote changes            │
│  • Automerge.save/load() - Serialize to bytes          │
│  • Subscriber pattern - Notify TanStack DB             │
└─────────────┬───────────────────────┬───────────────────┘
              │                       │
              ▼                       ▼
    ┌─────────────────┐    ┌──────────────────────────┐
    │   IndexedDB     │    │  Convex Component        │
    │   (local)       │    │  (cloud storage)         │
    │                 │    │                          │
    │ IndexedDB       │    │ @convex-replicate/       │
    │ StorageAdapter  │    │ storage                  │
    │                 │    │                          │
    │ Key:            │    │ CRDT-aware but impl-     │
    │ [coll, id]      │    │ agnostic                 │
    │ Value: bytes    │    │                          │
    │                 │    │ • submitSnapshot         │
    │ Auto-persists   │    │ • submitChange           │
    │ on change       │    │ • pullChanges            │
    └─────────────────┘    │ • compaction triggers    │
                           └──────────────────────────┘
```

### Layer Responsibilities

| Layer | Package | Responsibility | Runs Where |
|-------|---------|----------------|------------|
| **UI** | @convex-replicate/react | React hooks, provider | Client |
| **Reactive State** | TanStack DB | State management, subscriptions | Client |
| **CRDT Logic** | @convex-replicate/core | Automerge operations, merging | Client |
| **Local Storage** | IndexedDBStorageAdapter | Persist binary docs | Client (IndexedDB) |
| **Cloud Storage** | @convex-replicate/storage | Store snapshots/changes | Server (Convex) |

**Key Insight:** CRDT logic stays on client - server just stores opaque bytes!

---

## Package Structure

```
convex-replicate/
├── packages/
│   ├── core/                          # Framework-agnostic CRDT logic
│   │   ├── src/
│   │   │   ├── AutomergeDocumentStore.ts   # CRDT operations
│   │   │   ├── ConvexReplicateAdapter.ts   # Convex push/pull
│   │   │   ├── types.ts                    # Type definitions
│   │   │   └── index.ts                    # Public exports
│   │   └── package.json
│   │
│   ├── react/                         # React integration
│   │   ├── src/
│   │   │   ├── useConvexReplicate.ts       # Main hook
│   │   │   ├── ConvexReplicateProvider.tsx # Context provider
│   │   │   ├── createTanStackCollection.ts # TanStack DB bridge
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── storage/                       # Convex Component
│       ├── convex/
│       │   ├── schema.ts              # CRDT-aware schema
│       │   ├── public.ts              # submitSnapshot, submitChange, pullChanges
│       │   ├── compaction.ts          # Compaction triggers (Node action)
│       │   └── monitoring.ts          # Stats/metrics
│       ├── component.config.ts
│       └── package.json
│
└── examples/
    └── tanstack-start/                # Example app
        ├── src/
        │   └── hooks/useTasks.ts
        └── convex/
            └── tasks.ts
```

### Dependencies

**Remove from current convex-rx:**
- `rxdb` (~16.19.0) - Entire RxDB layer eliminated
- `rxjs` (7.8.2) - TanStack DB handles reactivity
- `@tanstack/rxdb-db-collection` - No longer needed
- `dexie` (4.2.1) - Using Automerge's storage adapter

**Add:**
- `@automerge/automerge` - Core CRDT library (client-side only)
- `@automerge/automerge-repo-storage-indexeddb` - Storage adapter (used standalone)

**Keep:**
- `@tanstack/react-db` - Reactive queries
- `convex` - Server SDK
- `@logtape/logtape` - Logging
- `zod` - Config validation

---

## Data Flow

### User Creates Document

```
1. User: actions.insert({ text: 'Hello' })
   ↓
2. TanStack DB: onInsert handler triggered
   ↓
3. AutomergeDocumentStore:
   const doc = Automerge.from({ id, text: 'Hello' })
   ↓
4. IndexedDB: storage.save(['tasks', id], Automerge.save(doc))
   ↓
5. Convex: submitSnapshot(collectionName, documentId, bytes)
   ↓
6. AutomergeDocumentStore: notifySubscribers()
   ↓
7. TanStack DB: sync function writes to collection state
   ↓
8. React: useLiveQuery re-renders component
```

### User Updates Document

```
1. User: actions.update(id, { text: 'World' })
   ↓
2. TanStack DB: onUpdate handler triggered
   ↓
3. AutomergeDocumentStore:
   const updated = Automerge.change(doc, d => { d.text = 'World' })
   ↓
4. IndexedDB: storage.save(['tasks', id], Automerge.save(updated))
   ↓
5. Convex: submitChange(collectionName, documentId, bytes)
   ↓
6. Notifications & re-render (same as create)
```

### Server Replication (Pull)

```
1. App Start: Initial pull
   ↓
2. Convex: pullChanges({ collectionName, checkpoint: { lastModified: 0 } })
   ↓
3. AutomergeDocumentStore:
   for each doc:
     const serverDoc = Automerge.load(doc.automergeBytes)
     const existing = store.get(id)
     if (existing):
       const merged = Automerge.merge(existing, serverDoc)  // ← CLIENT MERGES!
     else:
       store.set(id, serverDoc)
   ↓
4. IndexedDB: Persist merged docs
   ↓
5. Notifications & re-render
```

### Conflict Resolution (Automatic!)

```
Scenario: User edits doc offline while another user edits online

Client A (offline):
  doc = { text: 'Hello World' }  // Local change

Server (from Client B):
  doc = { text: 'Hello Friend' }  // Remote change

When Client A reconnects:
  pullChanges() receives server doc
  AutomergeDocumentStore:
    const clientDoc = store.get(id)           // { text: 'Hello World' }
    const serverDoc = Automerge.load(bytes)   // { text: 'Hello Friend' }
    const merged = Automerge.merge(clientDoc, serverDoc)
    // ← Automerge AUTOMATICALLY resolves conflict!
    // Result might be: { text: 'Hello World Friend' } (character-level merge)

No manual conflict handlers needed!
```

---

## Client-Side CRDT Layer

### AutomergeDocumentStore Class

**Purpose:** Manage Automerge documents for a collection (client-side)

**Key Responsibilities:**
1. Maintain in-memory `Map<id, Automerge.Doc<T>>`
2. Perform CRDT operations (change, merge)
3. Persist to IndexedDB
4. Track dirty documents for push
5. Notify subscribers (TanStack DB)

**Implementation:**

```typescript
// packages/core/src/AutomergeDocumentStore.ts

import * as Automerge from '@automerge/automerge'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'

export class AutomergeDocumentStore<T extends { id: string }> {
  private docs = new Map<string, Automerge.Doc<T>>()
  private storage: IndexedDBStorageAdapter
  private subscribers = new Set<(docs: T[]) => void>()
  private dirtyDocs = new Set<string>()  // Track changes for push

  constructor(private collectionName: string) {
    this.storage = new IndexedDBStorageAdapter({
      database: 'convex-replicate',
      store: collectionName,
    })
  }

  // Initialize: Load from IndexedDB
  async initialize(): Promise<void> {
    const chunks = await this.storage.loadRange([this.collectionName])

    for (const { key, data } of chunks) {
      const [, docId] = key  // key = [collectionName, docId]
      const doc = Automerge.load<T>(data)
      this.docs.set(docId, doc)
    }

    this.notifySubscribers()
  }

  // Create new document
  insert(id: string, data: Omit<T, 'id'>): Uint8Array {
    const doc = Automerge.from<T>({ ...data, id } as T)
    this.docs.set(id, doc)
    this.dirtyDocs.add(id)

    const bytes = Automerge.save(doc)
    this.persistToIndexedDB(id, bytes)
    this.notifySubscribers()

    return bytes  // Return for sending to Convex
  }

  // Update document via Automerge.change
  update(id: string, updateFn: (draft: T) => void): Uint8Array {
    const doc = this.docs.get(id)
    if (!doc) throw new Error(`Document ${id} not found`)

    const updated = Automerge.change(doc, updateFn)
    this.docs.set(id, updated)
    this.dirtyDocs.add(id)

    const bytes = Automerge.save(updated)
    this.persistToIndexedDB(id, bytes)
    this.notifySubscribers()

    return bytes  // Return for sending to Convex
  }

  // Soft delete
  delete(id: string): Uint8Array | null {
    const doc = this.docs.get(id)
    if (!doc) return null

    const updated = Automerge.change(doc, (draft: any) => {
      draft._deleted = true
      draft.updatedAt = Date.now()
    })

    this.docs.set(id, updated)
    this.dirtyDocs.add(id)

    const bytes = Automerge.save(updated)
    this.persistToIndexedDB(id, bytes)
    this.notifySubscribers()

    return bytes
  }

  // Merge remote changes (from Convex)
  async mergeFromServer(id: string, serverBytes: Uint8Array): Promise<void> {
    const serverDoc = Automerge.load<T>(serverBytes)
    const existing = this.docs.get(id)

    if (existing) {
      // CLIENT-SIDE MERGE - Conflict-free!
      const merged = Automerge.merge(existing, serverDoc)
      this.docs.set(id, merged)
    } else {
      // New document from server
      this.docs.set(id, serverDoc)
    }

    await this.persistToIndexedDB(id, serverBytes)
    this.notifySubscribers()
  }

  // Get dirty docs for push to Convex
  getDirtyDocs(): Array<{ id: string; bytes: Uint8Array }> {
    const dirty: Array<{ id: string; bytes: Uint8Array }> = []

    for (const id of this.dirtyDocs) {
      const doc = this.docs.get(id)
      if (doc) {
        dirty.push({ id, bytes: Automerge.save(doc) })
      }
    }

    return dirty
  }

  // Mark as synced (clear dirty flag)
  markAsSynced(id: string): void {
    this.dirtyDocs.delete(id)
  }

  // Get all docs as array (for TanStack DB)
  getAllAsArray(): T[] {
    const docs: T[] = []

    for (const doc of this.docs.values()) {
      const plainDoc = doc as unknown as T
      // Filter soft-deleted
      if (!(plainDoc as any)._deleted) {
        docs.push(plainDoc)
      }
    }

    return docs
  }

  // Subscribe to changes (for TanStack DB sync function)
  subscribe(callback: (docs: T[]) => void): () => void {
    this.subscribers.add(callback)
    callback(this.getAllAsArray())  // Initial value
    return () => this.subscribers.delete(callback)
  }

  // Private: Persist to IndexedDB
  private async persistToIndexedDB(id: string, bytes: Uint8Array): Promise<void> {
    await this.storage.save([this.collectionName, id], bytes)
  }

  // Private: Notify subscribers
  private notifySubscribers(): void {
    const docs = this.getAllAsArray()
    this.subscribers.forEach(cb => cb(docs))
  }
}
```

### ConvexReplicateAdapter

**Purpose:** Handle push/pull with Convex Component

```typescript
// packages/core/src/ConvexReplicateAdapter.ts

import type { ConvexClient } from 'convex/browser'
import type { AutomergeDocumentStore } from './AutomergeDocumentStore'

export class ConvexReplicateAdapter<T extends { id: string }> {
  private checkpoint = { lastModified: 0 }
  private pushIntervalId: NodeJS.Timeout | null = null

  constructor(
    private store: AutomergeDocumentStore<T>,
    private convexClient: ConvexClient,
    private api: {
      submitSnapshot: any
      submitChange: any
      pullChanges: any
      changeStream: any
    },
    private collectionName: string
  ) {}

  // Start replication
  async start(): Promise<void> {
    // Initial pull
    await this.pullFromConvex()

    // Subscribe to changes
    this.setupChangeStream()

    // Periodic push (every 5s)
    this.pushIntervalId = setInterval(() => this.pushToConvex(), 5000)
  }

  // Stop replication
  stop(): void {
    if (this.pushIntervalId) {
      clearInterval(this.pushIntervalId)
    }
  }

  // Pull changes from Convex
  private async pullFromConvex(): Promise<void> {
    const result = await this.convexClient.query(this.api.pullChanges, {
      collectionName: this.collectionName,
      checkpoint: this.checkpoint,
    })

    // Merge each document
    for (const doc of result.documents) {
      await this.store.mergeFromServer(doc.documentId, doc.automergeBytes)
    }

    // Update checkpoint
    this.checkpoint = result.checkpoint
  }

  // Push dirty docs to Convex
  private async pushToConvex(): Promise<void> {
    const dirtyDocs = this.store.getDirtyDocs()
    if (dirtyDocs.length === 0) return

    // Submit changes
    await this.convexClient.mutation(this.api.submitChange, {
      collectionName: this.collectionName,
      changes: dirtyDocs.map(({ id, bytes }) => ({
        documentId: id,
        data: bytes,
      })),
    })

    // Mark as synced
    dirtyDocs.forEach(({ id }) => this.store.markAsSynced(id))
  }

  // Subscribe to change stream
  private setupChangeStream(): void {
    this.convexClient.onUpdate(
      this.api.changeStream,
      { collectionName: this.collectionName },
      async (data: { count: number }) => {
        if (data.count > 0) {
          await this.pullFromConvex()
        }
      }
    )
  }
}
```

---

## Convex Storage Component

### Design Philosophy

**CRDT-aware but implementation-agnostic:**
- Understands snapshots vs incremental changes
- Doesn't know about Automerge specifically
- Could work with Yjs, Loro, Diamond Types, etc
- No Automerge dependency (NO server-side merging!)

**Why this matters:**
1. Works with any CRDT library
2. Can optimize for CRDT patterns (compaction)
3. No Convex runtime constraints
4. Reusable across projects

### Schema

```typescript
// packages/storage/convex/schema.ts

import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  // CRDT-aware storage
  documents: defineTable({
    // Identity
    collectionName: v.string(),
    documentId: v.string(),

    // CRDT pattern: snapshots vs changes
    type: v.union(
      v.literal("snapshot"),  // Full document state
      v.literal("change")     // Incremental update
    ),

    // Deduplication
    hash: v.string(),  // SHA-256 of data

    // Binary CRDT data (opaque to server!)
    data: v.bytes(),

    // Replication metadata
    timestamp: v.number(),
    size: v.number(),
  })
    .index('by_collection', ['collectionName'])
    .index('by_document', ['collectionName', 'documentId'])
    .index('by_hash', ['hash'])
    .index('by_timestamp', ['collectionName', 'timestamp']),

  // Track compaction state
  compactionState: defineTable({
    collectionName: v.string(),
    documentId: v.string(),
    lastCompactedAt: v.number(),
    changeCount: v.number(),
  })
    .index('by_document', ['collectionName', 'documentId']),
})
```

### Public API

**1. submitSnapshot (Mutation)**

Client sends full document snapshot:

```typescript
// packages/storage/convex/public.ts

export const submitSnapshot = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    data: v.bytes(),  // Opaque binary data
  },

  handler: async (ctx, { collectionName, documentId, data }) => {
    // Deduplication via hash
    const hash = await sha256Hash(data)

    const existing = await ctx.db
      .query('documents')
      .withIndex('by_hash', q => q.eq('hash', hash))
      .first()

    if (existing) {
      return { _id: existing._id, deduplicated: true }
    }

    // Store snapshot
    const _id = await ctx.db.insert('documents', {
      collectionName,
      documentId,
      type: 'snapshot',
      hash,
      data,
      timestamp: Date.now(),
      size: data.byteLength,
    })

    return { _id, deduplicated: false }
  },
})
```

**2. submitChange (Mutation)**

Client sends incremental change:

```typescript
export const submitChange = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    data: v.bytes(),
  },

  handler: async (ctx, { collectionName, documentId, data }) => {
    const hash = await sha256Hash(data)

    // Deduplication
    const existing = await ctx.db
      .query('documents')
      .withIndex('by_hash', q => q.eq('hash', hash))
      .first()

    if (existing) {
      return { _id: existing._id, deduplicated: true }
    }

    // Store change
    const _id = await ctx.db.insert('documents', {
      collectionName,
      documentId,
      type: 'change',
      hash,
      data,
      timestamp: Date.now(),
      size: data.byteLength,
    })

    // Update compaction state
    const state = await ctx.db
      .query('compactionState')
      .withIndex('by_document', q =>
        q.eq('collectionName', collectionName)
         .eq('documentId', documentId)
      )
      .first()

    if (state) {
      await ctx.db.patch(state._id, {
        changeCount: state.changeCount + 1,
      })
    } else {
      await ctx.db.insert('compactionState', {
        collectionName,
        documentId,
        lastCompactedAt: Date.now(),
        changeCount: 1,
      })
    }

    return { _id, deduplicated: false }
  },
})
```

**3. pullChanges (Query)**

Client pulls changes since checkpoint:

```typescript
export const pullChanges = query({
  args: {
    collectionName: v.string(),
    sinceTimestamp: v.number(),
    limit: v.optional(v.number()),
  },

  handler: async (ctx, { collectionName, sinceTimestamp, limit = 100 }) => {
    // Retention buffer: go back 5 min to catch out-of-order writes
    const bufferMs = 5 * 60 * 1000
    const queryStart = Math.max(0, sinceTimestamp - bufferMs)

    const results = await ctx.db
      .query('documents')
      .withIndex('by_timestamp', q =>
        q.eq('collectionName', collectionName)
         .gt('timestamp', queryStart)
      )
      .take(limit)

    return {
      changes: results.map(doc => ({
        documentId: doc.documentId,
        type: doc.type,
        data: doc.data,
        timestamp: doc.timestamp,
      })),
      hasMore: results.length === limit,
    }
  },
})
```

**4. changeStream (Query)**

Real-time change notifications:

```typescript
export const changeStream = query({
  args: {
    collectionName: v.string(),
    sinceTimestamp: v.optional(v.number()),
  },

  handler: async (ctx, { collectionName, sinceTimestamp = 0 }) => {
    const recentChanges = await ctx.db
      .query('documents')
      .withIndex('by_timestamp', q =>
        q.eq('collectionName', collectionName)
         .gt('timestamp', sinceTimestamp)
      )
      .collect()

    const latestTimestamp = recentChanges.reduce(
      (max, doc) => Math.max(max, doc.timestamp),
      sinceTimestamp
    )

    return {
      changes: recentChanges.map(doc => ({
        documentId: doc.documentId,
        timestamp: doc.timestamp,
      })),
      timestamp: latestTimestamp,
      count: recentChanges.length,
    }
  },
})
```

### Compaction (Optional)

**Server triggers compaction, client does the merging:**

```typescript
// packages/storage/convex/compaction.ts
"use node"

export const compactDocument = internalAction({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
  },

  handler: async (ctx, { collectionName, documentId }) => {
    // Check if compaction is needed
    const state = await ctx.runQuery(internal.compaction.getState, {
      collectionName,
      documentId,
    })

    if (!state || state.changeCount < 10) {
      return { compacted: false }
    }

    // Get all chunks for this document
    const chunks = await ctx.runQuery(internal.compaction.getChunks, {
      collectionName,
      documentId,
    })

    // Return chunks to client for merging
    // (Server doesn't merge - client does!)
    return {
      needsCompaction: true,
      chunks,
    }
  },
})
```

---

## TanStack DB Integration

### Understanding TanStack DB Collections

**What is a Collection?**
A TanStack DB Collection is a reactive, in-memory data store that:
- Manages state as a `Map<Key, Item>`
- Provides mutation methods (`insert`, `update`, `delete`)
- Notifies subscribers on changes
- Integrates with React via `useLiveQuery()`

**Live Query Collections:**
TanStack DB provides live query collections that automatically recompute when underlying data changes. Queries use a SQL-like fluent API that gets compiled into an optimized incremental pipeline.

**Important:** The query builder composes your query into an optimal pipeline - operations are NOT executed in the order you chain methods, but are optimized for performance.

**Custom Collection Pattern:**
We're creating a custom collection that syncs with Automerge (local CRDT) and Convex (cloud storage).

### Creating Collections

**Two approaches for creating collections:**

1. **Custom collection with sync** (what we use):
```typescript
const collection = createCollection({
  id: 'tasks',
  getKey: (item) => item.id,
  sync: { /* sync function */ },
  onInsert: async ({ transaction }) => { /* ... */ },
  onUpdate: async ({ transaction }) => { /* ... */ },
  onDelete: async ({ transaction }) => { /* ... */ },
})
```

2. **Live query collection** (for derived views):
```typescript
// Using liveQueryCollectionOptions
const activeUsers = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q.from({ user: usersCollection })
     .where(({ user }) => eq(user.active, true))
}))

// Or using convenience function
const activeUsers = createLiveQueryCollection((q) =>
  q.from({ user: usersCollection })
   .where(({ user }) => eq(user.active, true))
)
```

**Our architecture uses:**
- Custom collection for base data (synced with Automerge + Convex)
- Live query collections for derived views (filtering, joining, aggregating)

### The Sync Function Pattern

**Purpose:** Bridge external data source (Automerge) to TanStack DB reactive state

**Sync Function Signature:**
```typescript
sync: (params: {
  begin: () => void              // Start transaction
  write: (msg: ChangeMessage<T>) => void  // Write change
  commit: () => void             // Commit transaction (triggers reactivity)
  markReady: () => void          // Mark collection as ready
  collection: Collection<T>      // Access to collection instance
}) => (() => void) | void        // Return cleanup function
```

**ChangeMessage Types:**
```typescript
type ChangeMessage<T> =
  | { type: 'insert', value: T }   // Insert/upsert item
  | { type: 'update', value: T }   // Update item (full object)
  | { type: 'delete', value: T }   // Delete item
```

**Key Responsibilities:**
1. Subscribe to Automerge store changes
2. Write changes to TanStack DB using `begin()` → `write()` → `commit()`
3. Initialize with data from IndexedDB + Convex
4. Call `markReady()` when initial sync complete
5. Return cleanup function

**Implementation:**

```typescript
// packages/react/src/createTanStackCollection.ts

import { createCollection } from '@tanstack/db'
import type { AutomergeDocumentStore } from '@convex-replicate/core'
import type { ConvexClient } from 'convex/browser'

export function createTanStackCollection<T extends { id: string }>(
  store: AutomergeDocumentStore<T>,
  convexClient: ConvexClient,
  convexApi: any,
  collectionName: string
) {
  return createCollection({
    id: collectionName,
    getKey: (item) => item.id,

    // Sync function: Bridge Automerge → TanStack DB
    sync: {
      sync: ({ begin, write, commit, markReady, collection }) => {
        let isReady = false

        // Subscribe to Automerge store changes
        const unsubscribe = store.subscribe((docs) => {
          if (!isReady) return  // Wait for initial load

          // Write all docs to TanStack DB
          // Note: TanStack DB handles deduplication via getKey()
          begin()
          docs.forEach(doc => {
            write({ type: 'insert', value: doc })
          })
          commit()  // Triggers React re-renders!
        })

        // Initial load
        async function init() {
          try {
            // 1. Load from IndexedDB
            await store.initialize()

            // 2. Pull from Convex
            await store.pullFromConvex()

            // 3. Write initial data to TanStack DB
            begin()
            store.getAllAsArray().forEach(doc => {
              write({ type: 'insert', value: doc })
            })
            commit()

            // 4. Mark as ready
            isReady = true
            markReady()  // CRITICAL: Must always call!
          } catch (error) {
            console.error('Initial sync failed:', error)
            // Even on error, mark ready to prevent infinite loading
            markReady()
          }
        }

        init()

        // Cleanup function
        return () => {
          unsubscribe()
        }
      }
    },

    // Mutation handlers: User actions → Automerge → Convex
    onInsert: async ({ transaction, collection }) => {
      // Handle all inserts in transaction (usually just one)
      for (const mutation of transaction.mutations) {
        const item = mutation.modified

        // Create Automerge doc
        const bytes = store.insert(item.id, item)

        // Send to Convex (snapshot for new docs)
        await convexClient.mutation(convexApi.submitSnapshot, {
          collectionName,
          documentId: item.id,
          data: bytes,
        })
      }
    },

    onUpdate: async ({ transaction, collection }) => {
      // Handle all updates in transaction
      for (const mutation of transaction.mutations) {
        const key = mutation.key as string
        const updated = mutation.modified  // Full updated object

        // Update via Automerge.change()
        const bytes = store.update(key, draft => {
          // Apply all changes
          Object.assign(draft, updated)
        })

        // Send to Convex (incremental change)
        await convexClient.mutation(convexApi.submitChange, {
          collectionName,
          documentId: key,
          data: bytes,
        })
      }
    },

    onDelete: async ({ transaction, collection }) => {
      // Handle all deletes in transaction
      for (const mutation of transaction.mutations) {
        const key = mutation.key as string

        // Soft delete in Automerge
        const bytes = store.delete(key)

        if (bytes) {
          await convexClient.mutation(convexApi.submitChange, {
            collectionName,
            documentId: key,
            data: bytes,
          })
        }
      }
    },
  })
}
```

### Reactivity Flow

**How changes propagate to React:**

```
User Action
  ↓
collection.insert({ ... })
  ↓
onInsert handler
  ↓
AutomergeDocumentStore.insert()
  ↓
store.notifySubscribers()
  ↓
Sync function callback
  ↓
begin() → write({ type: 'insert', value }) → commit()
  ↓
TanStack DB updates state Map
  ↓
useLiveQuery() re-runs
  ↓
React component re-renders
```

**Key Insight:**
- Mutations go through Automerge FIRST, then notify TanStack DB
- TanStack DB doesn't directly mutate - it receives notifications via sync function
- This ensures Automerge is always the source of truth

### Event Buffering Pattern (Advanced)

**Purpose:** Prevent race conditions during initial load

When syncing with real-time data sources, events may fire during initial load. This pattern ensures no events are lost:

```typescript
sync: ({ begin, write, commit, markReady }) => {
  const eventBuffer: Array<any> = []
  let isInitialSyncComplete = false

  // 1. Subscribe FIRST (before initial load)
  const unsubscribe = store.subscribe((docs) => {
    if (!isInitialSyncComplete) {
      // Buffer events during initial load
      eventBuffer.push(docs)
      return
    }

    // Process real-time events normally
    begin()
    docs.forEach(doc => write({ type: 'insert', value: doc }))
    commit()
  })

  // 2. Initial load
  async function init() {
    try {
      // Load data
      await store.initialize()
      await store.pullFromConvex()

      // Write initial data
      begin()
      store.getAllAsArray().forEach(doc => {
        write({ type: 'insert', value: doc })
      })
      commit()

      // 3. Process buffered events
      isInitialSyncComplete = true
      if (eventBuffer.length > 0) {
        begin()
        // Use latest buffered state (deduplicate)
        const latestDocs = eventBuffer[eventBuffer.length - 1]
        latestDocs.forEach(doc => write({ type: 'insert', value: doc }))
        commit()
        eventBuffer.splice(0)  // Clear buffer
      }
    } catch (error) {
      console.error('Sync error:', error)
    } finally {
      // Always mark ready, even on error
      markReady()
    }
  }

  init()
  return unsubscribe
}
```

**Why This Matters:**
- Without buffering, events during initial load could be lost
- With buffering, all changes are captured and applied after initial load
- Ensures consistency between local and remote state

### Common TanStack DB Patterns

**Pattern 1: Simple Sync (No Real-Time)**
```typescript
// For one-time data loads
sync: {
  sync: async ({ begin, write, commit, markReady }) => {
    const data = await fetchData()

    begin()
    data.forEach(item => write({ type: 'insert', value: item }))
    commit()

    markReady()
  }
}
```

**Pattern 2: Real-Time Sync (What We Use)**
```typescript
// For continuous syncing with external data source
sync: {
  sync: ({ begin, write, commit, markReady }) => {
    // Subscribe to changes
    const unsubscribe = externalStore.subscribe((data) => {
      begin()
      data.forEach(item => write({ type: 'insert', value: item }))
      commit()
    })

    // Initial load
    async function init() {
      await loadInitialData()
      markReady()
    }
    init()

    return unsubscribe  // Cleanup
  }
}
```

**Pattern 3: Polling**
```typescript
// For polling-based sync
sync: {
  sync: ({ begin, write, commit, markReady, collection }) => {
    let intervalId: NodeJS.Timeout

    const poll = async () => {
      const data = await fetchData()
      begin()
      data.forEach(item => write({ type: 'insert', value: item }))
      commit()
    }

    async function init() {
      await poll()  // Initial load
      intervalId = setInterval(poll, 5000)  // Poll every 5s
      markReady()
    }

    init()

    return () => clearInterval(intervalId)  // Cleanup
  }
}
```

### Advanced Query Patterns

**findOne - Single Record Queries**

Use `findOne()` to return a single result instead of an array:

```typescript
// Find specific user by ID
const user = createLiveQueryCollection((q) =>
  q
    .from({ users: usersCollection })
    .where(({ users }) => eq(users.id, userId))
    .findOne()
)
// Type: User | undefined (not User[])

// In React
const { data: user } = useLiveQuery((q) =>
  q
    .from({ users: usersCollection })
    .where(({ users }) => eq(users.id, userId))
    .findOne()
, [userId])
```

**distinct - Remove Duplicates**

Use `distinct()` to get unique values (requires `select`):

```typescript
const uniqueCountries = createLiveQueryCollection((q) =>
  q
    .from({ users: usersCollection })
    .select(({ users }) => ({ country: users.country }))
    .distinct()
)
```

**having - Filter Aggregations**

Use `having()` to filter after aggregation:

```typescript
const highValueCustomers = createLiveQueryCollection((q) =>
  q
    .from({ orders: ordersCollection })
    .groupBy(({ orders }) => orders.customerId)
    .select(({ orders }) => ({
      customerId: orders.customerId,
      totalSpent: sum(orders.amount),
    }))
    .having(({ orders }) => gt(sum(orders.amount), 1000))
)
```

**orderBy / limit / offset - Sorting and Pagination**

```typescript
const topUsers = createLiveQueryCollection((q) =>
  q
    .from({ users: usersCollection })
    .orderBy(({ users }) => users.createdAt, 'desc')
    .limit(10)
    .offset(0)
)
```

**Conditional Queries (React)**

Return `undefined` to disable a query:

```typescript
const { data, isEnabled } = useLiveQuery((q) => {
  if (!userId) return undefined // Disable when no userId

  return q
    .from({ todos: todosCollection })
    .where(({ todos }) => eq(todos.userId, userId))
}, [userId])

// When disabled: status === 'disabled', isEnabled === false
```

**Functional Variants (Advanced)**

Use `fn.*` methods for complex JavaScript logic that can't be expressed declaratively:

```typescript
// fn.where - Complex filtering with JavaScript
const complexFilter = createLiveQueryCollection((q) =>
  q
    .from({ users: usersCollection })
    .fn.where((row) => {
      const user = row.users
      return user.active &&
             (user.age > 25 || user.role === 'admin') &&
             user.email.includes('@company.com')
    })
)

// fn.select - Complex transformations
const transformed = createLiveQueryCollection((q) =>
  q
    .from({ users: usersCollection })
    .fn.select((row) => ({
      id: row.users.id,
      displayName: `${row.users.firstName} ${row.users.lastName}`,
      emailDomain: row.users.email.split('@')[1],
      salaryTier: row.users.salary > 100000 ? 'senior' : 'junior',
    }))
)

// fn.having - Complex aggregation filtering
const filtered = createLiveQueryCollection((q) =>
  q
    .from({ orders: ordersCollection })
    .groupBy(({ orders }) => orders.customerId)
    .select(({ orders }) => ({
      customerId: orders.customerId,
      total: sum(orders.amount),
      count: count(orders.id),
    }))
    .fn.having((row) => row.total > 1000 && row.count >= 3)
)
```

**⚠️ Warning:** Functional variants bypass query optimization and cannot use indexes. Use only when declarative API is insufficient.

### Mutation Lifecycle and Error Handling

**Understanding the Mutation Flow**

When you mutate a collection, TanStack DB follows this lifecycle:

```
1. Optimistic State Applied
   ↓
2. Mutation Handler Invoked (onInsert/onUpdate/onDelete)
   ↓
3. Backend Persistence (Convex mutation)
   ↓
4. Sync Back (Automerge store merges server response)
   ↓
5. Optimistic State Dropped (replaced by confirmed state)
```

**In our architecture:**

```typescript
// User updates a task
collection.update(taskId, (draft) => {
  draft.isCompleted = true
})

// Lifecycle:
// 1. TanStack DB applies optimistic state immediately
// 2. onUpdate handler is triggered
// 3. AutomergeDocumentStore.update() creates new Automerge doc
// 4. Convex submitChange() persists bytes to server
// 5. store.notifySubscribers() triggers TanStack DB sync function
// 6. TanStack DB replaces optimistic with confirmed state
```

**Transaction States:**

- `pending` - Initial state, optimistic mutations can be applied
- `persisting` - Mutation handler is executing
- `completed` - Successfully persisted and synced
- `failed` - Error occurred, optimistic state rolled back automatically

**Error Handling Pattern:**

```typescript
// In mutation handlers
onUpdate: async ({ transaction, collection }) => {
  for (const mutation of transaction.mutations) {
    try {
      const bytes = store.update(mutation.key as string, draft => {
        Object.assign(draft, mutation.modified)
      })

      await convexClient.mutation(convexApi.submitChange, {
        collectionName,
        documentId: mutation.key,
        data: bytes,
      })
    } catch (error) {
      // Throwing error automatically rolls back optimistic state
      logger.error('Update failed', { error, key: mutation.key })
      throw error
    }
  }
}

// In components
const handleUpdate = async (id: string, updates: Partial<Task>) => {
  try {
    const tx = collection.update(id, draft => {
      Object.assign(draft, updates)
    })

    await tx.isPersisted.promise
    // Success!
  } catch (error) {
    // Optimistic state has been automatically rolled back
    if (error instanceof SchemaValidationError) {
      toast.error(`Validation error: ${error.issues[0]?.message}`)
    } else {
      toast.error('Failed to update task')
    }
  }
}
```

**Collection Status Monitoring:**

```typescript
const { data, status, isError, isLoading, isReady } = useLiveQuery((q) =>
  q.from({ tasks: collection })
)

if (isError) {
  // Collection is in error state
  // Data is still available (cached), but replication failed
  return <Alert>Replication failed. <button onClick={() => collection.utils.clearError()}>Retry</button></Alert>
}

if (isLoading) return <Spinner />
// Render data
```

**Graceful Degradation:**

Even when replication fails, the collection remains usable with cached data. The optimistic mutation system ensures users can continue working offline, with changes queued for retry.

### Temporary ID Strategy

**Our Approach: Client-Generated UUIDs**

We use client-generated UUIDs for document IDs, which eliminates the temporary ID problem entirely:

```typescript
// Generate stable UUID on client
const id = crypto.randomUUID()

// Insert with stable ID
await actions.insert({
  id,
  text: 'New task',
  isCompleted: false,
})

// No flicker - ID never changes
// Subsequent operations work immediately
await actions.delete(id) // Uses same ID
```

**Why This Works:**

1. **No UI flicker** - React components never remount due to ID changes
2. **Immediate operations** - Delete/update work right away, no waiting for server ID
3. **Automerge compatibility** - Automerge documents need stable IDs for CRDT merging
4. **Offline-first** - Works perfectly in offline scenarios

**Alternative: Temporary IDs (if needed)**

If you need server-generated IDs, use negative numbers for temporary IDs:

```typescript
const tempId = -Math.floor(Math.random() * 1000000) + 1

const tx = collection.insert({
  id: tempId,
  text: 'New task',
  isCompleted: false,
})

// Disable operations until persisted
const { isPersisted } = tx

// In component
<button
  onClick={() => collection.delete(task.id)}
  disabled={!isPersisted}
>
  Delete
</button>
```

**Best Practice:** Always use UUIDs with Automerge to avoid complexity.

---

## Developer Experience

### Basic Usage

```typescript
// src/hooks/useTasks.ts

import { useConvexReplicate } from '@convex-replicate/react'
import { api } from '../convex/_generated/api'

interface Task {
  id: string
  text: string
  isCompleted: boolean
  createdAt: number
}

export function useTasks() {
  return useConvexReplicate<Task>({
    collectionName: 'tasks',
    convexApi: api.storage,
  })
}

// In component
function TodoList() {
  const { data, status, actions } = useTasks()

  if (status === 'loading') return <div>Loading...</div>

  return (
    <div>
      {data.map(task => (
        <div key={task.id}>
          <input
            type="checkbox"
            checked={task.isCompleted}
            onChange={() => actions.update(task.id, {
              isCompleted: !task.isCompleted
            })}
          />
          <span>{task.text}</span>
          <button onClick={() => actions.delete(task.id)}>Delete</button>
        </div>
      ))}

      <button onClick={() => actions.insert({
        text: 'New task',
        isCompleted: false,
        createdAt: Date.now(),
      })}>
        Add Task
      </button>
    </div>
  )
}
```

### Custom Actions

```typescript
export function useTasks() {
  return useConvexReplicate<Task>({
    collectionName: 'tasks',
    convexApi: api.storage,

    // Extend with custom actions
    actions: (base) => ({
      ...base,

      toggle: async (id: string) => {
        const task = await base.get(id)
        await base.update(id, { isCompleted: !task.isCompleted })
      },

      bulkComplete: async (ids: string[]) => {
        for (const id of ids) {
          await base.update(id, { isCompleted: true })
        }
      },
    }),
  })
}

// Usage
const { actions } = useTasks()
await actions.toggle(taskId)
await actions.bulkComplete([id1, id2, id3])
```

### Derived Views with Live Queries

```typescript
// Base collection
export function useTasks() {
  return useConvexReplicate<Task>({
    collectionName: 'tasks',
    convexApi: api.storage,
  })
}

// Derived view - active tasks only
export function useActiveTasks() {
  const { collection } = useTasks()

  return useLiveQuery((q) =>
    q
      .from({ tasks: collection })
      .where(({ tasks }) => eq(tasks.isCompleted, false))
      .orderBy(({ tasks }) => tasks.createdAt, 'desc')
  )
}

// Derived view - single task
export function useTask(id: string) {
  const { collection } = useTasks()

  return useLiveQuery((q) => {
    if (!id) return undefined // Conditional query

    return q
      .from({ tasks: collection })
      .where(({ tasks }) => eq(tasks.id, id))
      .findOne()
  }, [id])
}

// Usage in component
function TodoList() {
  const { data: activeTasks } = useActiveTasks()
  const { actions } = useTasks()

  return (
    <div>
      {activeTasks?.map(task => (
        <div key={task.id}>
          <span>{task.text}</span>
          <button onClick={() => actions.update(task.id, { isCompleted: true })}>
            Complete
          </button>
        </div>
      ))}
    </div>
  )
}
```

### SSR Support

```typescript
// app/routes/tasks.tsx

import { preloadConvexReplicate } from '@convex-replicate/react'

export async function loader() {
  const tasks = await preloadConvexReplicate({
    collectionName: 'tasks',
    convexUrl: process.env.CONVEX_URL!,
  })

  return { tasks }
}

export default function TasksRoute() {
  const { tasks } = useLoaderData()

  const { data } = useTasks({
    initialData: tasks,  // Hydrate from SSR
  })

  // ...
}
```

---

## API Reference

### Core Package (@convex-replicate/core)

**AutomergeDocumentStore<T>**

```typescript
class AutomergeDocumentStore<T extends { id: string }> {
  constructor(collectionName: string)

  initialize(): Promise<void>
  insert(id: string, data: Omit<T, 'id'>): Uint8Array
  update(id: string, updateFn: (draft: T) => void): Uint8Array
  delete(id: string): Uint8Array | null
  mergeFromServer(id: string, bytes: Uint8Array): Promise<void>
  getDirtyDocs(): Array<{ id: string; bytes: Uint8Array }>
  markAsSynced(id: string): void
  getAllAsArray(): T[]
  subscribe(callback: (docs: T[]) => void): () => void
}
```

**ConvexSyncAdapter<T>**

```typescript
class ConvexSyncAdapter<T extends { id: string }> {
  constructor(
    store: AutomergeDocumentStore<T>,
    convexClient: ConvexClient,
    api: ConvexStorageAPI,
    collectionName: string
  )

  start(): Promise<void>
  stop(): void
}
```

### React Package (@convex-replicate/react)

**useConvexReplicate<T>()**

```typescript
function useConvexReplicate<T extends { id: string }>(config: {
  collectionName: string
  convexApi: ConvexStorageAPI
  initialData?: T[]
  actions?: (base: BaseActions<T>) => CustomActions
}): {
  collection: Collection<T>
  data: T[]
  status: 'loading' | 'ready' | 'error'
  actions: Actions<T>
}
```

**useLiveQuery<T>()**

From `@tanstack/react-db`:

```typescript
function useLiveQuery<T>(
  queryFn: (q: QueryBuilder) => Query | Collection | undefined,
  deps?: DependencyList
): {
  data: T[] | T | undefined
  collection: Collection<T> | undefined
  status: 'loading' | 'ready' | 'error' | 'disabled'
  isLoading: boolean
  isReady: boolean
  isEnabled: boolean
  isIdle: boolean
  isError: boolean
}
```

**ConvexReplicateProvider**

```typescript
function ConvexReplicateProvider({
  convexUrl: string
  children: React.ReactNode
}): JSX.Element
```

**createLiveQueryCollection<T>()**

From `@tanstack/db`:

```typescript
function createLiveQueryCollection<T>(
  queryFn: (q: QueryBuilder) => Query
): Collection<T>

// Or with options
function createCollection<T>(
  options: LiveQueryCollectionOptions<T>
): Collection<T>
```

### Storage Component (@convex-replicate/storage)

**Convex Functions:**

```typescript
// Public API
api.storage.submitSnapshot(collectionName, documentId, data)
api.storage.submitChange(collectionName, documentId, data)
api.storage.pullChanges(collectionName, sinceTimestamp, limit?)
api.storage.changeStream(collectionName, sinceTimestamp?)
```

---

## Implementation Roadmap

### Phase 1: Core Infrastructure ⏳

**Week 1-2: Automerge Layer**
- [ ] AutomergeDocumentStore class
  - [ ] In-memory Map<id, Doc> management
  - [ ] insert/update/delete operations
  - [ ] Subscriber pattern
- [ ] IndexedDB integration
  - [ ] Initialize from storage
  - [ ] Persist on change (debounced)
- [ ] Tests for CRDT operations

**Week 2-3: Sync Adapter**
- [ ] ConvexSyncAdapter class
  - [ ] Push dirty docs
  - [ ] Pull changes
  - [ ] Change stream subscription
- [ ] Checkpoint management
- [ ] Offline queue handling

### Phase 2: Convex Storage Component ⏳

**Week 3-4: Component Implementation**
- [ ] Schema definition
  - [ ] documents table
  - [ ] compactionState table
- [ ] Public API
  - [ ] submitSnapshot mutation
  - [ ] submitChange mutation
  - [ ] pullChanges query
  - [ ] changeStream query
- [ ] Deduplication (SHA-256 hash)
- [ ] Compaction triggers (Node action)

**Week 4-5: Testing & Optimization**
- [ ] Component tests
- [ ] Performance profiling
- [ ] Monitoring/stats API

### Phase 3: React Integration ⏳

**Week 5-6: TanStack DB Bridge**
- [ ] createTanStackCollection function
  - [ ] Sync function implementation
  - [ ] Mutation handlers
  - [ ] Event buffering
- [ ] useConvexReplicate hook
- [ ] ConvexReplicateProvider

**Week 6-7: DX Enhancements**
- [ ] Custom actions support
- [ ] SSR preloading
- [ ] Error handling
- [ ] Loading states

### Phase 4: Example & Documentation ⏳

**Week 7-8: Example App**
- [ ] Migrate tanstack-start example
- [ ] Add multiple collections
- [ ] Demonstrate custom actions
- [ ] Show SSR pattern

**Week 8-9: Documentation**
- [ ] API documentation
- [ ] Migration guide (convex-rx → convex-replicate)
- [ ] Tutorials
- [ ] Update CLAUDE.md

### Phase 5: Polish & Launch ⏳

**Week 9-10: Final Polish**
- [ ] Remove all RxDB code
- [ ] Final testing
- [ ] Performance optimization
- [ ] Security audit

**Week 10: Launch**
- [ ] Publish packages
- [ ] Announce on Twitter/Discord
- [ ] Gather feedback

---

## Success Criteria

- ✅ Research phase complete
- ⏳ All RxDB code removed (719+ lines)
- ⏳ Example app works identically to current version
- ⏳ True CRDT conflict resolution (no manual handlers)
- ⏳ Cleaner API (no function builder)
- ⏳ Better performance (fewer layers)
- ⏳ Component is reusable across projects
- ⏳ Documentation complete

---

**Status:** Architecture finalized - Ready for implementation!
**Next Step:** Begin Phase 1 - Core Infrastructure
