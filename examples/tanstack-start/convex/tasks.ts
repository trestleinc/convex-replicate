import {
  submitDocumentHelper,
  pullChangesHelper,
  changeStreamHelper,
} from '@convex-replicate/core/convex-helpers';
import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { v } from 'convex/values';

export const submitDocument = mutation({
  args: {
    id: v.string(),
    document: v.any(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    return await submitDocumentHelper(ctx, components.replicate, 'tasks', args);
  },
});

export const pullChanges = query({
  args: {
    checkpoint: v.object({ lastModified: v.number() }),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await pullChangesHelper(ctx, 'tasks', args);
  },
});

export const changeStream = query({
  handler: async (ctx) => {
    return await changeStreamHelper(ctx, 'tasks');
  },
});
