import { mutation, query } from './_generated/server';
import { components } from './_generated/api';
import { ConvexReplicateStorage } from '../../src/client';
import { v } from 'convex/values';
import * as Automerge from '@automerge/automerge';

interface TestDocument {
  id: string;
  message: string;
}

const testStorage = new ConvexReplicateStorage<TestDocument>(
  components.replicate,
  'test-collection'
);

/**
 * Insert a new test document with CRDT bytes
 */
export const insertTestDocument = mutation({
  args: {
    documentId: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    // Create Automerge CRDT
    const doc = Automerge.from({
      id: args.documentId,
      message: args.message,
    });
    const crdtBytes = Automerge.save(doc);

    return await testStorage.insertDocument(
      ctx,
      args.documentId,
      crdtBytes.buffer as ArrayBuffer,
      1
    );
  },
});

/**
 * Update an existing test document with CRDT bytes
 */
export const updateTestDocument = mutation({
  args: {
    documentId: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    // Create updated Automerge CRDT
    const doc = Automerge.from({
      id: args.documentId,
      message: args.message,
    });
    const crdtBytes = Automerge.save(doc);

    return await testStorage.updateDocument(
      ctx,
      args.documentId,
      crdtBytes.buffer as ArrayBuffer,
      2
    );
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
 */
export const pullTestChanges = query({
  args: {
    lastModified: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await testStorage.pullChanges(ctx, { lastModified: args.lastModified ?? 0 }, 10);

    // Materialize the CRDT bytes for easier inspection
    return {
      ...result,
      changes: result.changes.map((change) => ({
        documentId: change.documentId,
        document: Automerge.load<TestDocument>(new Uint8Array(change.crdtBytes)),
        version: change.version,
        timestamp: change.timestamp,
      })),
    };
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
