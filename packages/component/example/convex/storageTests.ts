import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { v } from 'convex/values';

export const submitTestSnapshot = mutation({
  args: {
    documentId: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const testData = new TextEncoder().encode(args.message).buffer;

    const result = await ctx.runMutation(components.storage.public.submitSnapshot, {
      collectionName: 'test-collection',
      documentId: args.documentId,
      data: testData,
    });

    return result;
  },
});

export const submitTestChange = mutation({
  args: {
    documentId: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const testData = new TextEncoder().encode(args.message).buffer;

    const result = await ctx.runMutation(components.storage.public.submitChange, {
      collectionName: 'test-collection',
      documentId: args.documentId,
      data: testData,
    });

    return result;
  },
});

export const pullTestChanges = query({
  args: {
    lastModified: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(components.storage.public.pullChanges, {
      collectionName: 'test-collection',
      checkpoint: { lastModified: args.lastModified ?? 0 },
      limit: 10,
    });

    const decodedChanges = result.changes.map(
      (change: {
        documentId: string;
        type: 'snapshot' | 'change';
        data: ArrayBuffer;
        timestamp: number;
        size: number;
      }) => ({
        documentId: change.documentId,
        type: change.type,
        message: new TextDecoder().decode(change.data),
        timestamp: change.timestamp,
        size: change.size,
      })
    );

    return {
      changes: decodedChanges,
      checkpoint: result.checkpoint,
      hasMore: result.hasMore,
    };
  },
});

export const getTestMetadata = query({
  args: {
    documentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.storage.public.getDocumentMetadata, {
      collectionName: 'test-collection',
      documentId: args.documentId,
    });
  },
});

export const getChangeStream = query({
  handler: async (ctx) => {
    return await ctx.runQuery(components.storage.public.changeStream, {
      collectionName: 'test-collection',
    });
  },
});
