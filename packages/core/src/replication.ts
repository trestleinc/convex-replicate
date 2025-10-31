import type { GenericDataModel } from 'convex/server';

function cleanDocument(doc: unknown): unknown {
  return Object.fromEntries(
    Object.entries(doc as Record<string, unknown>).filter(
      ([_, value]) => value !== undefined && value !== null
    )
  );
}

/**
 * Submit a document to both the CRDT component and the main application table.
 *
 * DUAL-STORAGE ARCHITECTURE:
 * This helper implements a dual-storage pattern where documents are stored in two places:
 *
 * 1. Component Storage (CRDT Layer):
 *    - Stores Automerge CRDT data for offline-first conflict resolution
 *    - Handles concurrent updates with automatic merging
 *    - Provides the source of truth for offline changes
 *
 * 2. Main Application Table:
 *    - Stores materialized documents for efficient querying
 *    - Used by server-side Convex functions that need to query/join data
 *    - Optimized for reactive subscriptions and complex queries
 *
 * WHY BOTH?
 * - Component: Handles conflict resolution and offline sync
 * - Main table: Enables efficient server-side queries and subscriptions
 * - Similar to event sourcing: component = event log, main table = read model
 *
 * @param ctx - Convex mutation context
 * @param components - Generated components from Convex
 * @param tableName - Name of the main application table
 * @param args - Document data with id, document, and version
 * @returns Success indicator
 */
export async function submitDocumentHelper<_DataModel extends GenericDataModel>(
  ctx: unknown,
  components: unknown,
  tableName: string,
  args: { id: string; document: unknown; version: number }
): Promise<{ success: boolean }> {
  await (ctx as any).runMutation((components as any).replicate.public.submitDocument, {
    collectionName: tableName,
    documentId: args.id,
    document: args.document,
    version: args.version,
  });

  const db = (ctx as any).db;
  const existing = await db
    .query(tableName)
    .withIndex('by_user_id', (q: unknown) => (q as any).eq('id', args.id))
    .first();

  const cleanDoc = cleanDocument(args.document) as Record<string, unknown>;

  if (existing) {
    await db.patch(existing._id, {
      ...cleanDoc,
      version: args.version,
      timestamp: Date.now(),
    });
  } else {
    await db.insert(tableName, {
      id: args.id,
      ...cleanDoc,
      version: args.version,
      timestamp: Date.now(),
    });
  }

  return { success: true };
}

/**
 * Pull document changes from the main application table.
 *
 * This reads from the materialized table (not the component storage) to provide
 * efficient querying with proper indexing. Changes are pulled incrementally using
 * a checkpoint-based approach.
 *
 * @param ctx - Convex query context
 * @param tableName - Name of the main application table
 * @param args - Checkpoint and limit for pagination
 * @returns Array of changes with new checkpoint
 */
export async function pullChangesHelper<_DataModel extends GenericDataModel>(
  ctx: unknown,
  tableName: string,
  args: { checkpoint: { lastModified: number }; limit?: number }
): Promise<{
  changes: Array<{
    documentId: unknown;
    document: unknown;
    version: unknown;
    timestamp: unknown;
  }>;
  checkpoint: { lastModified: number };
  hasMore: boolean;
}> {
  const db = (ctx as any).db;
  const docs = await db
    .query(tableName)
    .withIndex('by_timestamp', (q: unknown) =>
      (q as any).gt('timestamp', args.checkpoint.lastModified)
    )
    .order('asc')
    .take(args.limit ?? 100);

  const activeChanges = docs
    .filter((doc: unknown) => (doc as any).deleted !== true)
    .map((doc: unknown) => {
      const {
        _id,
        _creationTime,
        timestamp: _timestamp,
        version: _version,
        deleted: _deleted,
        ...rest
      } = doc as Record<string, unknown>;
      return {
        documentId: (doc as any).id,
        document: rest,
        version: (doc as any).version,
        timestamp: (doc as any).timestamp,
      };
    });

  return {
    changes: activeChanges,
    checkpoint: {
      lastModified: docs[docs.length - 1]?.timestamp ?? args.checkpoint.lastModified,
    },
    hasMore: docs.length === (args.limit ?? 100),
  };
}

/**
 * Get the latest timestamp and count for a table's change stream.
 *
 * This provides a lightweight way to detect when changes occur in the main
 * application table, triggering reactive updates in the client.
 *
 * @param ctx - Convex query context
 * @param tableName - Name of the main application table
 * @returns Latest timestamp and document count
 */
export async function changeStreamHelper<_DataModel extends GenericDataModel>(
  ctx: unknown,
  tableName: string
): Promise<{ timestamp: number; count: number }> {
  const db = (ctx as any).db;
  const allDocs = await db.query(tableName).collect();
  let latestTimestamp = 0;

  for (const doc of allDocs) {
    if (doc.timestamp > latestTimestamp) {
      latestTimestamp = doc.timestamp;
    }
  }

  return {
    timestamp: latestTimestamp,
    count: allDocs.length,
  };
}
