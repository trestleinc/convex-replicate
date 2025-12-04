import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  documents: defineTable({
    collection: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
    timestamp: v.number(),
  })
    .index('by_collection', ['collection'])
    .index('by_collection_document_version', ['collection', 'documentId', 'version'])
    .index('by_timestamp', ['collection', 'timestamp']),

  snapshots: defineTable({
    collection: v.string(),
    snapshotBytes: v.bytes(),
    latestCompactionTimestamp: v.number(),
    createdAt: v.number(),
  }).index('by_collection', ['collection']),

  versions: defineTable({
    collection: v.string(),
    documentId: v.string(),
    versionId: v.string(),
    stateBytes: v.bytes(),
    label: v.optional(v.string()),
    createdAt: v.number(),
    createdBy: v.optional(v.string()),
  })
    .index('by_document', ['collection', 'documentId', 'createdAt'])
    .index('by_version_id', ['versionId']),
});
