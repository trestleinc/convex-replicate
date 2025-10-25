import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { v } from 'convex/values';

export const submitDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    document: v.any(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.storage.public.submitDocument, args);
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
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.storage.public.pullChanges, args);
  },
});

export const changeStream = query({
  args: {
    collectionName: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.storage.public.changeStream, args);
  },
});
