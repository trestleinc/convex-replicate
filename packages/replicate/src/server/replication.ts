import type { GenericDataModel } from 'convex/server';

function cleanDocument(doc: unknown): unknown {
  return Object.fromEntries(
    Object.entries(doc as Record<string, unknown>).filter(
      ([_, value]) => value !== undefined && value !== null
    )
  );
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
 * @param ctx - Convex mutation context
 * @param components - Generated components from Convex
 * @param tableName - Name of the main application table
 * @param args - Document data with id, crdtBytes, materializedDoc, and version
 * @returns Success indicator
 */
export async function insertDocumentHelper<_DataModel extends GenericDataModel>(
  ctx: unknown,
  components: unknown,
  tableName: string,
  args: { id: string; crdtBytes: ArrayBuffer; materializedDoc: unknown; version: number }
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
 * @param ctx - Convex mutation context
 * @param components - Generated components from Convex
 * @param tableName - Name of the main application table
 * @param args - Document data with id, crdtBytes, materializedDoc, and version
 * @returns Success indicator
 */
export async function updateDocumentHelper<_DataModel extends GenericDataModel>(
  ctx: unknown,
  components: unknown,
  tableName: string,
  args: { id: string; crdtBytes: ArrayBuffer; materializedDoc: unknown; version: number }
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
 * Delete a document from both the CRDT component and the main application table.
 *
 * @param ctx - Convex mutation context
 * @param components - Generated components from Convex
 * @param tableName - Name of the main application table
 * @param args - Document ID
 * @returns Success indicator
 */
export async function deleteDocumentHelper<_DataModel extends GenericDataModel>(
  ctx: unknown,
  components: unknown,
  tableName: string,
  args: { id: string }
): Promise<{
  success: boolean;
  metadata: {
    documentId: string;
    timestamp: number;
    collectionName: string;
  };
}> {
  // Use timestamp for replication matching (deletes don't have version)
  const timestamp = Date.now();

  // Delete from component
  await (ctx as any).runMutation((components as any).replicate.public.deleteDocument, {
    collectionName: tableName,
    documentId: args.id,
  });

  // Delete from main table
  const db = (ctx as any).db;
  const existing = await db
    .query(tableName)
    .withIndex('by_user_id', (q: unknown) => (q as any).eq('id', args.id))
    .first();

  if (existing) {
    await db.delete(existing._id);
  }

  // Return metadata for replication matching
  return {
    success: true,
    metadata: {
      documentId: args.id,
      timestamp,
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
