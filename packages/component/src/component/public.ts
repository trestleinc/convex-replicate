import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const submitDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    document: v.any(),
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
      await ctx.db.patch(existing._id, {
        document: args.document,
        version: args.version,
        timestamp: Date.now(),
      });
    } else {
      await ctx.db.insert('documents', {
        collectionName: args.collectionName,
        documentId: args.documentId,
        document: args.document,
        version: args.version,
        timestamp: Date.now(),
      });
    }

    return { success: true };
  },
});

export const pullChanges = query({
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
        document: v.any(),
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
      document: doc.document,
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

export const changeStream = query({
  args: {
    collectionName: v.string(),
  },
  returns: v.object({
    timestamp: v.number(),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    const allDocs = await ctx.db
      .query('documents')
      .withIndex('by_collection', (q) => q.eq('collectionName', args.collectionName))
      .collect();

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
  },
});

export const getDocumentMetadata = query({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      documentId: v.string(),
      version: v.number(),
      timestamp: v.number(),
      document: v.any(),
    })
  ),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query('documents')
      .withIndex('by_collection_document', (q) =>
        q.eq('collectionName', args.collectionName).eq('documentId', args.documentId)
      )
      .first();

    if (!doc) {
      return null;
    }

    return {
      documentId: doc.documentId,
      version: doc.version,
      timestamp: doc.timestamp,
      document: doc.document,
    };
  },
});
