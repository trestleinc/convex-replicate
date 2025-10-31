import { ConvexReplicateStorage } from '@convex-replicate/component';
import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { v } from 'convex/values';

interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
}

const tasksStorage = new ConvexReplicateStorage<Task>(components.replicate, 'tasks');

export const submitDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    document: v.any(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    return await tasksStorage.submitDocument(ctx, args.documentId, args.document, args.version);
  },
});

export const pullChanges = query({
  args: {
    collectionName: v.string(),
    checkpoint: v.object({ lastModified: v.number() }),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await tasksStorage.pullChanges(ctx, args.checkpoint, args.limit);
  },
});

export const changeStream = query({
  args: {
    collectionName: v.string(),
  },
  handler: async (ctx) => {
    return await tasksStorage.changeStream(ctx);
  },
});
