import type { GenericDataModel } from 'convex/server';
import * as Y from 'yjs';

function cleanDocument(doc: unknown): unknown {
  return Object.fromEntries(
    Object.entries(doc as Record<string, unknown>).filter(
      ([_, value]) => value !== undefined && value !== null
    )
  );
}

/**
 * Default CRDT delta synthesis from materialized document.
 * Converts a plain object into Yjs CRDT bytes automatically.
 *
 * This is the standard way to synthesize deltas for manual server edits.
 * Users can provide custom implementation if needed, but this handles 99% of cases.
 *
 * @param doc - Materialized document from main table
 * @returns CRDT delta bytes (Yjs V2 encoding)
 */
export function defaultSynthesizeDelta(doc: any): ArrayBuffer {
  const ydoc = new Y.Doc();
  const ymap = ydoc.getMap('doc');

  ydoc.transact(() => {
    Object.entries(doc).forEach(([key, value]) => {
      // Skip Convex internal fields
      if (!key.startsWith('_')) {
        ymap.set(key, value);
      }
    });
  });

  const delta = Y.encodeStateAsUpdateV2(ydoc);
  ydoc.destroy(); // Clean up
  return delta.buffer as ArrayBuffer;
}

/**
 * Insert a document into both the CRDT component and the main application table.
 *
 * DUAL-STORAGE ARCHITECTURE:
 * This helper implements a dual-storage pattern where documents are stored in two places:
 *
 * 1. Component Storage (CRDT Layer):
 *    - Stores CRDT bytes (from Yjs) for offline-first conflict resolution
 *    - Handles concurrent updates with automatic merging
 *    - Provides the source of truth for offline changes
 *
 * 2. Main Application Table:
 *    - Stores materialized documents for efficient querying
 *    - Used by server-side Convex functions that need to query/join data
 *    - Optimized for reactive subscriptions and complex queries
 *
 * WHY BOTH?
 * - Component: Handles conflict resolution and offline replication (CRDT bytes)
 * - Main table: Enables efficient server-side queries (materialized docs)
 * - Similar to event sourcing: component = event log, main table = read model
 *
 * SCHEMA MIGRATIONS:
 * - Optional schemaVersion param enables client reconciliation during migrations
 * - When provided, server can apply transformation functions before storing
 * - Yjs CRDT merge happens automatically after transformation
 *
 * @param ctx - Convex mutation context
 * @param components - Generated components from Convex
 * @param tableName - Name of the main application table
 * @param args - Document data with id, crdtBytes, materializedDoc, version, and optional schemaVersion
 * @returns Success indicator
 */
export async function insertDocumentHelper<_DataModel extends GenericDataModel>(
  ctx: unknown,
  components: unknown,
  tableName: string,
  args: {
    id: string;
    crdtBytes: ArrayBuffer;
    materializedDoc: unknown;
    version: number;
    schemaVersion?: number;
  }
): Promise<{
  success: boolean;
  metadata: {
    documentId: string;
    timestamp: number;
    version: number;
    collectionName: string;
  };
}> {
  // Use consistent timestamp for both writes to enable sync matching
  const timestamp = Date.now();

  // Note: schemaVersion param available for user's migration logic
  // Users can check schemaVersion and apply transformations before writing
  // Example:
  //   if (args.schemaVersion && args.schemaVersion < currentVersion) {
  //     args.materializedDoc = await migrateDocument(args.materializedDoc, args.schemaVersion);
  //   }

  // Write CRDT bytes to component
  await (ctx as any).runMutation((components as any).replicate.public.insertDocument, {
    collectionName: tableName,
    documentId: args.id,
    crdtBytes: args.crdtBytes,
    version: args.version,
  });

  // Write materialized doc to main table
  const db = (ctx as any).db;
  const cleanDoc = cleanDocument(args.materializedDoc) as Record<string, unknown>;

  await db.insert(tableName, {
    id: args.id,
    ...cleanDoc,
    version: args.version,
    timestamp,
  });

  // Return metadata for replication matching
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

/**
 * Update a document in both the CRDT component and the main application table.
 *
 * SCHEMA MIGRATIONS:
 * - Optional schemaVersion param enables client reconciliation during migrations
 * - When provided, server can apply transformation functions before storing
 * - Yjs CRDT merge happens automatically after transformation
 *
 * @param ctx - Convex mutation context
 * @param components - Generated components from Convex
 * @param tableName - Name of the main application table
 * @param args - Document data with id, crdtBytes, materializedDoc, version, and optional schemaVersion
 * @returns Success indicator
 */
export async function updateDocumentHelper<_DataModel extends GenericDataModel>(
  ctx: unknown,
  components: unknown,
  tableName: string,
  args: {
    id: string;
    crdtBytes: ArrayBuffer;
    materializedDoc: unknown;
    version: number;
    schemaVersion?: number;
  }
): Promise<{
  success: boolean;
  metadata: {
    documentId: string;
    timestamp: number;
    version: number;
    collectionName: string;
  };
}> {
  // Use consistent timestamp for both writes to enable sync matching
  const timestamp = Date.now();

  // Note: schemaVersion param available for user's migration logic
  // Users can check schemaVersion and apply transformations before writing

  // Write CRDT bytes to component
  await (ctx as any).runMutation((components as any).replicate.public.updateDocument, {
    collectionName: tableName,
    documentId: args.id,
    crdtBytes: args.crdtBytes,
    version: args.version,
  });

  // Update materialized doc in main table
  const db = (ctx as any).db;
  const existing = await db
    .query(tableName)
    .withIndex('by_user_id', (q: unknown) => (q as any).eq('id', args.id))
    .first();

  if (!existing) {
    throw new Error(`Document ${args.id} not found in table ${tableName}`);
  }

  const cleanDoc = cleanDocument(args.materializedDoc) as Record<string, unknown>;

  await db.patch(existing._id, {
    ...cleanDoc,
    version: args.version,
    timestamp,
  });

  // Return metadata for replication matching
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
    crdtBytes: args.crdtBytes,
    version: args.version,
  });

  // 2. HARD DELETE from main table (physical removal)
  const db = (ctx as any).db;
  const existing = await db
    .query(tableName)
    .withIndex('by_user_id', (q: unknown) => (q as any).eq('id', args.id))
    .first();

  if (existing) {
    await db.delete(existing._id);
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

/**
 * Stream document changes from the CRDT component storage.
 *
 * This reads CRDT bytes from the component (not the main table) to enable
 * true Y.applyUpdate() conflict resolution on the client.
 * Can be used for both polling (awaitReplication) and subscriptions (live updates).
 *
 * @param ctx - Convex query context
 * @param components - Generated components from Convex
 * @param tableName - Name of the collection
 * @param args - Checkpoint and limit for pagination
 * @returns Array of changes with CRDT bytes
 */
export async function streamHelper<_DataModel extends GenericDataModel>(
  ctx: unknown,
  components: unknown,
  tableName: string,
  args: { checkpoint: { lastModified: number }; limit?: number }
): Promise<{
  changes: Array<{
    documentId: string;
    crdtBytes: ArrayBuffer;
    version: number;
    timestamp: number;
  }>;
  checkpoint: { lastModified: number };
  hasMore: boolean;
}> {
  return (ctx as any).runQuery((components as any).replicate.public.stream, {
    collectionName: tableName,
    checkpoint: args.checkpoint,
    limit: args.limit,
  });
}

/**
 * AUTOMATIC RESET HANDLING: Detect and synthesize deltas for manual server edits.
 *
 * This helper automatically detects when documents in the main table have been manually
 * edited (timestamp divergence) and synthesizes CRDT deltas to maintain consistency.
 *
 * Users don't control timestamps - the system does. So this detection is AUTOMATIC.
 *
 * Call this from your query/mutation BEFORE streaming to ensure manual edits are
 * captured as synthetic deltas in the component.
 *
 * @param ctx - Convex mutation context (needs mutation for component writes)
 * @param components - Generated components from Convex
 * @param tableName - Name of the collection
 * @param synthesizeDelta - Optional function to convert doc to CRDT bytes (defaults to defaultSynthesizeDelta)
 *
 * @example
 * ```typescript
 * // Simple: Use default synthesis (handles 99% of cases)
 * export const stream = query({
 *   handler: async (ctx, args) => {
 *     await detectAndSynthesizeDeltas(ctx, components, 'tasks');
 *     return await streamHelper(ctx, components, 'tasks', args);
 *   },
 * });
 *
 * // Advanced: Custom synthesis for complex types
 * export const stream = query({
 *   handler: async (ctx, args) => {
 *     await detectAndSynthesizeDeltas(ctx, components, 'tasks', (doc) => {
 *       // Custom CRDT encoding for nested structures
 *       return customEncode(doc);
 *     });
 *     return await streamHelper(ctx, components, 'tasks', args);
 *   },
 * });
 * ```
 */
export async function detectAndSynthesizeDeltas<_DataModel extends GenericDataModel>(
  ctx: unknown,
  components: unknown,
  tableName: string,
  synthesizeDelta?: (doc: any) => ArrayBuffer
): Promise<{ synthesizedCount: number }> {
  const synthesize = synthesizeDelta ?? defaultSynthesizeDelta;
  const db = (ctx as any).db;

  // Get all documents from main table
  const mainTableDocs = await db.query(tableName).collect();

  // Get latest component timestamps for each document
  const componentTimestamps = new Map<string, number>();

  for (const doc of mainTableDocs) {
    // Get latest delta for this document from component
    const latestDelta = await (ctx as any).runQuery(
      (components as any).replicate.public.getDocumentHistory,
      {
        collectionName: tableName,
        documentId: doc.id,
      }
    );

    if (latestDelta && latestDelta.length > 0) {
      const latest = latestDelta[latestDelta.length - 1];
      componentTimestamps.set(doc.id, latest.timestamp);
    }
  }

  let synthesizedCount = 0;

  // Detect timestamp divergence and synthesize deltas
  for (const doc of mainTableDocs) {
    const componentTimestamp = componentTimestamps.get(doc.id) ?? 0;

    // Divergence detected: main table timestamp > component timestamp
    if (doc.timestamp > componentTimestamp) {
      // Synthesize CRDT delta from materialized doc (automatic!)
      const syntheticDelta = synthesize(doc);

      // Store in component (automatic!)
      await (ctx as any).runMutation((components as any).replicate.public.storeSyntheticDelta, {
        collectionName: tableName,
        documentId: doc.id,
        crdtBytes: syntheticDelta,
        version: doc.version,
      });

      synthesizedCount++;
    }
  }

  return { synthesizedCount };
}
