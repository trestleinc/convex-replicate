import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  documents: defineTable({
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
    timestamp: v.number(),
    operationType: v.string(), // 'insert' | 'update' | 'delete'
  })
    .index('by_collection', ['collectionName'])
    .index('by_collection_document_version', ['collectionName', 'documentId', 'version'])
    .index('by_timestamp', ['collectionName', 'timestamp']),
});
