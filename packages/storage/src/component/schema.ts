import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  documents: defineTable({
    collectionName: v.string(),
    documentId: v.string(),
    type: v.union(v.literal('snapshot'), v.literal('change')),
    hash: v.string(),
    data: v.bytes(),
    timestamp: v.number(),
    size: v.number(),
  })
    .index('by_collection', ['collectionName'])
    .index('by_document', ['collectionName', 'documentId'])
    .index('by_hash', ['hash'])
    .index('by_timestamp', ['collectionName', 'timestamp']),
});
