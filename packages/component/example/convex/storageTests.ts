import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { ReplicateStorage } from '../../src/client';
import { v } from 'convex/values';

interface TestDocument {
  id: string;
  message: string;
}

const testStorage = new ReplicateStorage<TestDocument>(components.replicate, 'test-collection');

/**
 * Insert a new test document with CRDT bytes
 * Client must send CRDT bytes created with Automerge.save()
 */
export const insertTestDocument = mutation({
  args: {
    documentId: v.string(),
    crdtBytes: v.bytes(),
  },
  handler: async (ctx, args) => {
    return await testStorage.insertDocument(ctx, args.documentId, args.crdtBytes, 1);
  },
});

/**
 * Update an existing test document with CRDT bytes
 * Client must send CRDT bytes created with Automerge.save()
 */
export const updateTestDocument = mutation({
  args: {
    documentId: v.string(),
    crdtBytes: v.bytes(),
  },
  handler: async (ctx, args) => {
    return await testStorage.updateDocument(ctx, args.documentId, args.crdtBytes, 2);
  },
});

/**
 * Upsert (insert or update) a test document with CRDT bytes
 * Automatically detects if document exists and calls insert or update
 * Client must send CRDT bytes created with Automerge.save()
 */
export const upsertTestDocument = mutation({
  args: {
    documentId: v.string(),
    crdtBytes: v.bytes(),
  },
  handler: async (ctx, args) => {
    // Check if document exists by pulling all changes
    const existing = await testStorage.pullChanges(ctx, { lastModified: 0 }, 1000);
    const existingDoc = existing.changes.find((c) => c.documentId === args.documentId);

    if (existingDoc) {
      // Document exists - update it with incremented version
      return await testStorage.updateDocument(
        ctx,
        args.documentId,
        args.crdtBytes,
        existingDoc.version + 1
      );
    } else {
      // New document - insert it with version 1
      return await testStorage.insertDocument(ctx, args.documentId, args.crdtBytes, 1);
    }
  },
});

/**
 * Delete a test document
 */
export const deleteTestDocument = mutation({
  args: {
    documentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await testStorage.deleteDocument(ctx, args.documentId);
  },
});

/**
 * Pull changes - returns CRDT bytes
 * Client must use Automerge.load() to materialize the bytes
 */
export const pullTestChanges = query({
  args: {
    lastModified: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await testStorage.pullChanges(ctx, { lastModified: args.lastModified ?? 0 }, 10);
  },
});

/**
 * Get change stream
 */
export const getChangeStream = query({
  handler: async (ctx) => {
    return await testStorage.changeStream(ctx);
  },
});
