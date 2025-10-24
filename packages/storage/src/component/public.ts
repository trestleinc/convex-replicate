import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

function generateHash(data: ArrayBuffer): string {
  const hashBuffer = new Uint8Array(data).reduce((acc, byte) => acc + byte, 0);
  return hashBuffer.toString(16);
}

export const submitSnapshot = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    data: v.bytes(),
  },
  returns: v.object({
    id: v.id('documents'),
    deduplicated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const hash = generateHash(args.data);

    const existing = await ctx.db
      .query('documents')
      .withIndex('by_hash', (q) => q.eq('hash', hash))
      .first();

    if (existing) {
      return { id: existing._id, deduplicated: true };
    }

    const id = await ctx.db.insert('documents', {
      collectionName: args.collectionName,
      documentId: args.documentId,
      type: 'snapshot',
      hash,
      data: args.data,
      timestamp: Date.now(),
      size: args.data.byteLength,
    });

    return { id, deduplicated: false };
  },
});

export const submitChange = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    data: v.bytes(),
  },
  returns: v.object({
    id: v.id('documents'),
    deduplicated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const hash = generateHash(args.data);

    const existing = await ctx.db
      .query('documents')
      .withIndex('by_hash', (q) => q.eq('hash', hash))
      .first();

    if (existing) {
      return { id: existing._id, deduplicated: true };
    }

    const id = await ctx.db.insert('documents', {
      collectionName: args.collectionName,
      documentId: args.documentId,
      type: 'change',
      hash,
      data: args.data,
      timestamp: Date.now(),
      size: args.data.byteLength,
    });

    return { id, deduplicated: false };
  },
});

export const submitBatch = mutation({
  args: {
    operations: v.array(
      v.object({
        collectionName: v.string(),
        documentId: v.string(),
        type: v.union(v.literal('snapshot'), v.literal('change')),
        data: v.bytes(),
      })
    ),
  },
  returns: v.array(
    v.object({
      id: v.id('documents'),
      deduplicated: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    const results = [];

    for (const op of args.operations) {
      const hash = generateHash(op.data);

      const existing = await ctx.db
        .query('documents')
        .withIndex('by_hash', (q) => q.eq('hash', hash))
        .first();

      if (existing) {
        results.push({ id: existing._id, deduplicated: true });
        continue;
      }

      const id = await ctx.db.insert('documents', {
        collectionName: op.collectionName,
        documentId: op.documentId,
        type: op.type,
        hash,
        data: op.data,
        timestamp: Date.now(),
        size: op.data.byteLength,
      });

      results.push({ id, deduplicated: false });
    }

    return results;
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
        type: v.union(v.literal('snapshot'), v.literal('change')),
        data: v.bytes(),
        timestamp: v.number(),
        size: v.number(),
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
      type: doc.type,
      data: doc.data,
      timestamp: doc.timestamp,
      size: doc.size,
    }));

    const newCheckpoint = {
      lastModified:
        documents.length > 0
          ? documents[documents.length - 1]?.timestamp
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
    totalSize: v.number(),
  }),
  handler: async (ctx, args) => {
    const allDocs = await ctx.db
      .query('documents')
      .withIndex('by_collection', (q) => q.eq('collectionName', args.collectionName))
      .collect();

    let latestTimestamp = 0;
    let totalSize = 0;

    for (const doc of allDocs) {
      if (doc.timestamp > latestTimestamp) {
        latestTimestamp = doc.timestamp;
      }
      totalSize += doc.size;
    }

    return {
      timestamp: latestTimestamp,
      count: allDocs.length,
      totalSize,
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
      snapshotCount: v.number(),
      changeCount: v.number(),
      latestSnapshot: v.union(
        v.null(),
        v.object({
          timestamp: v.number(),
          size: v.number(),
          hash: v.string(),
        })
      ),
      latestChange: v.union(
        v.null(),
        v.object({
          timestamp: v.number(),
          size: v.number(),
          hash: v.string(),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query('documents')
      .withIndex('by_document', (q) =>
        q.eq('collectionName', args.collectionName).eq('documentId', args.documentId)
      )
      .collect();

    if (docs.length === 0) {
      return null;
    }

    const snapshots = docs.filter((d) => d.type === 'snapshot');
    const changes = docs.filter((d) => d.type === 'change');

    const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
    const latestChange = changes.length > 0 ? changes[changes.length - 1] : null;

    return {
      documentId: args.documentId,
      snapshotCount: snapshots.length,
      changeCount: changes.length,
      latestSnapshot: latestSnapshot
        ? {
            timestamp: latestSnapshot.timestamp,
            size: latestSnapshot.size,
            hash: latestSnapshot.hash,
          }
        : null,
      latestChange: latestChange
        ? {
            timestamp: latestChange.timestamp,
            size: latestChange.size,
            hash: latestChange.hash,
          }
        : null,
    };
  },
});
