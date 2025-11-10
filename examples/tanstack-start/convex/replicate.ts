import { query, internalMutation } from './_generated/server';
import { components } from './_generated/api';
import { v } from 'convex/values';

/**
 * Get the protocol version from the replicate component.
 * This wrapper is required for the client to check protocol compatibility.
 */
export const getProtocolVersion = query({
  handler: async (ctx) => {
    return await ctx.runQuery(components.replicate.public.getProtocolVersion);
  },
});

/**
 * Compact all collections with CRDT deltas.
 * This wrapper is required for cron jobs (crons can't reference component functions directly).
 */
export const compact = internalMutation({
  args: {
    cutoffDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.replicate.compaction.compactSeries, args);
  },
});

/**
 * Clean up old snapshots.
 * This wrapper is required for cron jobs (crons can't reference component functions directly).
 */
export const prune = internalMutation({
  args: {
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.replicate.compaction.prune, args);
  },
});
