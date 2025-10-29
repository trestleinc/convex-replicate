import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  documents: defineTable({
    collectionName: v.string(),
    documentId: v.string(),
    document: v.any(),
    version: v.number(),
    timestamp: v.number(),
  })
    .index('by_collection', ['collectionName'])
    .index('by_collection_document', ['collectionName', 'documentId'])
    .index('by_timestamp', ['collectionName', 'timestamp']),
});
