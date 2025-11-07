import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  documents: defineTable({
    collection: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
    timestamp: v.number(),
    operationType: v.string(), // 'insert' | 'update' | 'delete'
  })
    .index('by_collection', ['collection'])
    .index('by_collection_document_version', ['collection', 'documentId', 'version'])
    .index('by_timestamp', ['collection', 'timestamp']),
});
