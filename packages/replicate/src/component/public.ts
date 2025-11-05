import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Insert a new document with CRDT bytes (Yjs format).
 *
 * @param collectionName - Collection identifier
 * @param documentId - Unique document identifier
 * @param crdtBytes - ArrayBuffer containing Yjs CRDT bytes (Y.encodeStateAsUpdate)
 * @param version - CRDT version number
 */
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
    const existing = await ctx.db
      .query('documents')
      .withIndex('by_collection_document', (q) =>
        q.eq('collectionName', args.collectionName).eq('documentId', args.documentId)
      )
      .first();

    if (existing) {
      throw new Error(
        `Document ${args.documentId} already exists in collection ${args.collectionName}. Use updateDocument instead.`
      );
    }

    await ctx.db.insert('documents', {
      collectionName: args.collectionName,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Update an existing document with new CRDT bytes (Yjs format).
 *
 * @param collectionName - Collection identifier
 * @param documentId - Unique document identifier
 * @param crdtBytes - ArrayBuffer containing Yjs CRDT bytes (Y.encodeStateAsUpdate)
 * @param version - CRDT version number
 */
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
    const existing = await ctx.db
      .query('documents')
      .withIndex('by_collection_document', (q) =>
        q.eq('collectionName', args.collectionName).eq('documentId', args.documentId)
      )
      .first();

    if (!existing) {
      throw new Error(
        `Document ${args.documentId} not found in collection ${args.collectionName}. Use insertDocument instead.`
      );
    }

    await ctx.db.patch(existing._id, {
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Delete a document from CRDT storage.
 *
 * @param collectionName - Collection identifier
 * @param documentId - Unique document identifier
 */
export const deleteDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query('documents')
      .withIndex('by_collection_document', (q) =>
        q.eq('collectionName', args.collectionName).eq('documentId', args.documentId)
      )
      .first();

    if (doc) {
      await ctx.db.delete(doc._id);
    }

    return { success: true };
  },
});

/**
 * Stream CRDT changes for incremental replication.
 * Returns Yjs CRDT bytes for documents modified since the checkpoint.
 * Can be used for both polling (awaitReplication) and subscriptions (live updates).
 *
 * @param collectionName - Collection identifier
 * @param checkpoint - Last replication checkpoint
 * @param limit - Maximum number of changes to return (default: 100)
 */
export const stream = query({
  args: {
    collectionName: v.string(),
    checkpoint: v.object({
      lastModified: v.number(),
    }),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    changes: v.array(
      v.object({
        documentId: v.string(),
        crdtBytes: v.bytes(),
        version: v.number(),
        timestamp: v.number(),
      })
    ),
    checkpoint: v.object({
      lastModified: v.number(),
    }),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    const documents = await ctx.db
      .query('documents')
      .withIndex('by_timestamp', (q) =>
        q.eq('collectionName', args.collectionName).gt('timestamp', args.checkpoint.lastModified)
      )
      .order('asc')
      .take(limit);

    const changes = documents.map((doc) => ({
      documentId: doc.documentId,
      crdtBytes: doc.crdtBytes,
      version: doc.version,
      timestamp: doc.timestamp,
    }));

    const newCheckpoint = {
      lastModified:
        documents.length > 0
          ? (documents[documents.length - 1]?.timestamp ?? args.checkpoint.lastModified)
          : args.checkpoint.lastModified,
    };

    return {
      changes,
      checkpoint: newCheckpoint,
      hasMore: documents.length === limit,
    };
  },
});
