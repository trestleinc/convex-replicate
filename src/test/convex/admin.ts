import { v } from 'convex/values';
import { components } from './_generated/api';
import { testingMutation } from './testing';

/**
 * Test-only wrapper mutations for calling component functions from browser tests.
 *
 * These wrappers call the component's public compaction/pruning functions directly,
 * allowing tests to use any collection name (not just the one configured in defineReplicate).
 *
 * Guarded by IS_TEST environment variable to prevent production use.
 */

/**
 * Test-only wrapper for component compaction (supports any collection name)
 */
export const compactPosts = testingMutation({
  args: {
    collection: v.string(),
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.replicate.public.compactCollectionByName, {
      collection: args.collection,
      retentionDays: args.retentionDays,
    });
  },
});

/**
 * Test-only wrapper for component pruning (supports any collection name)
 */
export const prunePosts = testingMutation({
  args: {
    collection: v.string(),
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.replicate.public.pruneCollectionByName, {
      collection: args.collection,
      retentionDays: args.retentionDays,
    });
  },
});

/**
 * Test-only wrapper for users compaction
 */
export const compactUsers = testingMutation({
  args: {
    collection: v.string(),
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.replicate.public.compactCollectionByName, {
      collection: args.collection,
      retentionDays: args.retentionDays,
    });
  },
});

/**
 * Test-only wrapper for users pruning
 */
export const pruneUsers = testingMutation({
  args: {
    collection: v.string(),
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.replicate.public.pruneCollectionByName, {
      collection: args.collection,
      retentionDays: args.retentionDays,
    });
  },
});

/**
 * Test-only wrapper for comments compaction
 */
export const compactComments = testingMutation({
  args: {
    collection: v.string(),
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.replicate.public.compactCollectionByName, {
      collection: args.collection,
      retentionDays: args.retentionDays,
    });
  },
});

/**
 * Test-only wrapper for comments pruning
 */
export const pruneComments = testingMutation({
  args: {
    collection: v.string(),
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.replicate.public.pruneCollectionByName, {
      collection: args.collection,
      retentionDays: args.retentionDays,
    });
  },
});
