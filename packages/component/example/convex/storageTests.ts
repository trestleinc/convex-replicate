import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { v } from 'convex/values';

export const submitTestDocument = mutation({
  args: {
    documentId: v.string(),
    message: v.string(),
    version: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.runMutation(components.replicate.public.submitDocument, {
      collectionName: 'test-collection',
      documentId: args.documentId,
      document: { message: args.message },
      version: args.version ?? 1,
    });

    return result;
  },
});

export const pullTestChanges = query({
  args: {
    lastModified: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(components.replicate.public.pullChanges, {
      collectionName: 'test-collection',
      checkpoint: { lastModified: args.lastModified ?? 0 },
      limit: 10,
    });

    return result;
  },
});

export const getTestMetadata = query({
  args: {
    documentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.replicate.public.getDocumentMetadata, {
      collectionName: 'test-collection',
      documentId: args.documentId,
    });
  },
});

export const getChangeStream = query({
  handler: async (ctx) => {
    return await ctx.runQuery(components.replicate.public.changeStream, {
      collectionName: 'test-collection',
    });
  },
});
