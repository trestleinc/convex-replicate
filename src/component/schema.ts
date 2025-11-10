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

  // Snapshots for compacted history
  // One snapshot per collection (not per document!)
  snapshots: defineTable({
    collection: v.string(),
    snapshotBytes: v.bytes(), // V2 encoded entire collection Y.Doc
    latestCompactionTimestamp: v.number(), // Timestamp of newest delta included in snapshot
    createdAt: v.number(), // When this snapshot was created
  }).index('by_collection', ['collection']),
});
