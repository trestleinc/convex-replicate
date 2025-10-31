import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { ConvexReplicateStorage } from '../../src/client';
import { v } from 'convex/values';

interface TestDocument {
  id: string;
  message: string;
}

const testStorage = new ConvexReplicateStorage<TestDocument>(
  components.replicate,
  'test-collection'
);

export const submitTestDocument = mutation({
  args: {
    documentId: v.string(),
    message: v.string(),
    version: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await testStorage.submitDocument(
      ctx,
      args.documentId,
      { id: args.documentId, message: args.message },
      args.version ?? 1
    );
  },
});

export const pullTestChanges = query({
  args: {
    lastModified: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await testStorage.pullChanges(ctx, { lastModified: args.lastModified ?? 0 }, 10);
  },
});

export const getTestMetadata = query({
  args: {
    documentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await testStorage.getDocumentMetadata(ctx, args.documentId);
  },
});

export const getChangeStream = query({
  handler: async (ctx) => {
    return await testStorage.changeStream(ctx);
  },
});

// Example using the .for() scoped API
const doc123 = testStorage.for('doc-123');

export const submitDoc123 = mutation({
  args: {
    message: v.string(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    return await doc123.submit(ctx, { id: 'doc-123', message: args.message }, args.version);
  },
});

export const getDoc123Metadata = query({
  handler: async (ctx) => {
    return await doc123.getMetadata(ctx);
  },
});
