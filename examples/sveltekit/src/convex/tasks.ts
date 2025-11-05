import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { v } from 'convex/values';
import {
  insertDocumentHelper,
  updateDocumentHelper,
  pullChangesHelper,
  changeStreamHelper,
} from '@trestleinc/replicate/replication';

/**
 * TanStack DB endpoints - called by convexCollectionOptions
 *
 * These receive CRDT bytes from the client and use replication helpers
 * to write to both the component (CRDT bytes) and main table (materialized docs).
 */

export const insertDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    materializedDoc: v.any(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    return await insertDocumentHelper(ctx, components, 'tasks', {
      id: args.documentId,
      crdtBytes: args.crdtBytes,
      materializedDoc: args.materializedDoc,
      version: args.version,
    });
  },
});

export const updateDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    materializedDoc: v.any(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    // Also used for soft deletes (materializedDoc includes deleted: true)
    return await updateDocumentHelper(ctx, components, 'tasks', {
      id: args.documentId,
      crdtBytes: args.crdtBytes,
      materializedDoc: args.materializedDoc,
      version: args.version,
    });
  },
});

/**
 * Stream endpoint for real-time subscriptions
 * Returns ALL items including soft-deleted ones for proper Yjs CRDT synchronization
 * UI layer filters out deleted items for display
 */
export const stream = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect();
  },
});

export const pullChanges = query({
  args: {
    collectionName: v.string(),
    checkpoint: v.object({ lastModified: v.number() }),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await pullChangesHelper(ctx, components, 'tasks', {
      checkpoint: args.checkpoint,
      limit: args.limit,
    });
  },
});

export const changeStream = query({
  args: {
    collectionName: v.string(),
  },
  handler: async (ctx) => {
    return await changeStreamHelper(ctx, components, 'tasks');
  },
});

/**
 * Regular query endpoints for SSR/server-side operations
 * Returns ALL items including deleted for proper CRDT state
 * SSR loader will filter out deleted items
 */

export const getTasks = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect();
  },
});
