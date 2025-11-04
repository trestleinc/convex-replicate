import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { v } from 'convex/values';
import {
  insertDocumentHelper,
  updateDocumentHelper,
  deleteDocumentHelper,
  pullChangesHelper,
  changeStreamHelper,
} from '@trestleinc/convex-replicate-core/replication';

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
    return await updateDocumentHelper(ctx, components, 'tasks', {
      id: args.documentId,
      crdtBytes: args.crdtBytes,
      materializedDoc: args.materializedDoc,
      version: args.version,
    });
  },
});

export const deleteDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await deleteDocumentHelper(ctx, components, 'tasks', {
      id: args.documentId,
    });
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
 * These read from the materialized main table for efficient queries
 */

export const getTasks = query({
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect();
  },
});
