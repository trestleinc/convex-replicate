# Native Rich Text Editor Support for Replicate

## Executive Summary

**Goal:** Add native ProseMirror-based editor support (TipTap/BlockNote) to the replicate package as a flagship feature, with per-field rich text capabilities.

## Critical Discovery: Y.Map Can Contain Y.XmlFragment!

Yjs allows **any Yjs type as a value in Y.Map**, including Y.XmlFragment:

```javascript
// A document with mixed field types - ALL in one Y.Doc!
const doc = new Y.Doc()
const documentMap = doc.getMap('document-123')

// Regular fields (existing replicate pattern)
documentMap.set('title', 'My Document')           // string
documentMap.set('createdAt', Date.now())          // number
documentMap.set('tags', new Y.Array())            // Y.Array

// Rich text field - Y.XmlFragment for ProseMirror!
const contentFragment = new Y.XmlFragment()
documentMap.set('content', contentFragment)       // Y.XmlFragment ✓

// The fragment can be bound directly to TipTap/BlockNote
Collaboration.configure({ fragment: documentMap.get('content') })
```

**This means:**
- No need for separate sync systems (OT vs CRDT)
- Documents can have multiple rich text fields
- Everything syncs together in one Y.Doc with one delta stream
- Full offline support for ALL fields including rich text

## Why NOT to Use prosemirror-sync Component

| Issue | Impact |
|-------|--------|
| **Two sync paradigms** | OT for docs + CRDT for other fields = complexity |
| **Separate offline handling** | prosemirror-sync uses debounced snapshots, not queued deltas |
| **No field-level rich text** | Each doc is standalone, can't mix with other fields |
| **Inconsistent conflict resolution** | OT is server-authoritative, CRDT is automatic merge |

---

## Recommended Approach: Native Y.XmlFragment in Y.Map

Since Y.Map can contain Y.XmlFragment, we can extend the **existing replicate architecture** to support rich text fields natively.

### Current Architecture

```
Y.Doc
  └── Y.Map<string, Y.Map<unknown>>  (collection)
        └── Y.Map<unknown>           (document with primitive fields)
```

### Extended Architecture

```
Y.Doc
  └── Y.Map<string, Y.Map<unknown>>  (collection)
        └── Y.Map<unknown>           (document)
              ├── title: string
              ├── createdAt: number
              └── content: Y.XmlFragment  ← NEW: rich text field
```

### What Changes Are Needed

| Layer | Current | With Rich Text |
|-------|---------|----------------|
| **Schema** | Primitive types | Add `v.richText()` type |
| **Client Y.Map** | Stores primitives | Also stores Y.XmlFragment |
| **Delta capture** | Same `transactWithDelta()` | Works unchanged! |
| **Server storage** | `crdtBytes` | Works unchanged! |
| **Materialized doc** | JSON fields | JSON + ProseMirror JSON |

### Key Insight: Minimal Server Changes

The server-side delta storage **already works** for Y.XmlFragment because:
- `Y.encodeStateAsUpdateV2()` encodes ALL Yjs types
- `Y.mergeUpdatesV2()` merges ALL Yjs types
- `Y.applyUpdateV2()` applies ALL Yjs types

The deltas are opaque binary blobs - the server doesn't care what's inside!

---

## Implementation Plan

### Phase 1: Schema Support

Add a new field type for rich text:

```typescript
// src/server/schema.ts
import { v } from "convex/values";

// New validator for rich text fields
export const richText = () => v.object({
  type: v.literal("prosemirror"),
  content: v.any(),  // ProseMirror JSON when materialized
});

// Usage in user's schema
tasks: replicatedTable({
  id: v.string(),
  title: v.string(),
  description: richText(),  // ← Rich text field
  completed: v.boolean(),
})
```

### Phase 2: Client-Side Y.XmlFragment Handling

Modify collection setup to handle rich text fields:

```typescript
// src/client/collection.ts (modified)

// When inserting a document with rich text fields
const applyYjsInsert = (mutations: CollectionMutation<T>[]): Uint8Array => {
  const { delta } = transactWithDelta(ydoc, () => {
    mutations.forEach((mut) => {
      const itemYMap = new Y.Map();

      Object.entries(mut.modified).forEach(([key, value]) => {
        if (isRichTextField(value)) {
          // Create Y.XmlFragment for rich text
          const fragment = new Y.XmlFragment();
          // Initialize with content if provided
          if (value.content) {
            initializeFragment(fragment, value.content);
          }
          itemYMap.set(key, fragment);
        } else {
          itemYMap.set(key, value);
        }
      });

      ymap.set(String(mut.key), itemYMap);
    });
  });
  return delta;
};
```

### Phase 3: Fragment Accessor for Editor Binding

Expose the Y.XmlFragment for editor integration:

```typescript
// src/client/collection.ts (new export)

export function getFragment<T>(
  collection: Collection<T>,
  documentId: string,
  field: keyof T
): Y.XmlFragment | null {
  const itemMap = ymap.get(documentId);
  if (!itemMap) return null;

  const fragment = itemMap.get(field as string);
  if (fragment instanceof Y.XmlFragment) {
    return fragment;
  }
  return null;
}
```

### Phase 4: React Hook for Editor Integration

```typescript
// src/client/editor.ts (new file)

export function useReplicateEditor<T>(options: {
  collection: Collection<T>;
  documentId: string;
  field: keyof T;
}): {
  fragment: Y.XmlFragment | null;
  isLoading: boolean;
} {
  const [fragment, setFragment] = useState<Y.XmlFragment | null>(null);

  useEffect(() => {
    const frag = getFragment(options.collection, options.documentId, options.field);
    setFragment(frag);
  }, [options.documentId, options.field]);

  return { fragment, isLoading: fragment === null };
}
```

### Phase 5: Usage Example

```typescript
// User's code
import { useReplicateEditor } from '@trestleinc/replicate/client';
import { useEditor } from '@tiptap/react';
import Collaboration from '@tiptap/extension-collaboration';

function TaskEditor({ taskId }: { taskId: string }) {
  const { fragment, isLoading } = useReplicateEditor({
    collection: tasksCollection,
    documentId: taskId,
    field: 'description',
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Collaboration.configure({ fragment }),
    ],
  }, [fragment]);

  if (isLoading) return <div>Loading...</div>;
  return <EditorContent editor={editor} />;
}
```

---

## Performance: Yjs vs OT

| Aspect | Yjs (CRDT) | OT (prosemirror-sync) |
|--------|------------|----------------------|
| **Conflict resolution** | Automatic merge, no server round-trip | Server must resolve |
| **Offline support** | Full - deltas queue locally | Limited - debounced snapshots |
| **Delta size** | Slightly larger (CRDT metadata) | Smaller steps |
| **Merge complexity** | O(n) for n updates | O(n²) worst case |
| **Consistency** | Eventually consistent | Requires server ordering |

**For replicate's use case (offline-first):** Yjs is the clear winner because:
1. Same sync model for all fields (no split brain)
2. Full offline queuing works automatically
3. No additional server complexity

---

## Editor Bindings (from docs.yjs.dev)

| Binding | Editor | Maturity | Notes |
|---------|--------|----------|-------|
| **y-prosemirror** | ProseMirror/TipTap | Most mature | Official, widely used |
| y-tiptap | TipTap | Wrapper | Thin wrapper over y-prosemirror |
| y-blocknote | BlockNote | Newer | Uses y-prosemirror internally |
| y-monaco | Monaco | Mature | Code editors |
| y-quill | Quill | Mature | Simple rich text |
| y-codemirror | CodeMirror | Mature | Code editors |

**Recommendation:** Target **y-prosemirror** as the foundation since both TipTap and BlockNote are built on ProseMirror.

---

## Files to Create/Modify

### New Files
```
src/client/editor.ts         # useReplicateEditor hook, getFragment
src/client/rich-text.ts      # Y.XmlFragment initialization helpers
```

### Modified Files
```
src/client/collection.ts     # Handle Y.XmlFragment in mutations
src/client/index.ts          # Export editor utilities
src/server/schema.ts         # Add richText() validator
src/server/index.ts          # Export richText
```

### No Server Component Changes!
The delta storage already handles any Yjs type.

---

## Status: Future Roadmap

This is research and design for future implementation.

**Key findings:**
1. Y.Map can contain Y.XmlFragment - enables per-field rich text
2. Existing delta storage works unchanged for rich text
3. Native Yjs approach is better than prosemirror-sync for offline-first
4. Implementation is primarily client-side changes

**Sources:**
- [Yjs Documentation](https://docs.yjs.dev)
- [y-prosemirror](https://github.com/yjs/y-prosemirror)
- [TipTap Collaboration](https://tiptap.dev/docs/editor/extensions/functionality/collaboration)
- [BlockNote Collaboration](https://www.blocknotejs.org/docs/collaboration)
- [Convex ProseMirror Sync](https://www.convex.dev/components/prosemirror-sync) (for comparison)
