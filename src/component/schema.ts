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

  // Compaction state tracking (for gap detection)
  compactionState: defineTable({
    collectionName: v.string(),
    oldestDeltaTimestamp: v.number(), // Oldest delta still available
    latestSnapshotTimestamp: v.number(), // Latest snapshot created
    lastCompactionRun: v.number(), // Last time compaction ran
  }).index('by_collection', ['collectionName']),

  // Snapshots table with V2 encoding
  snapshots: defineTable({
    collectionName: v.string(),
    documentId: v.string(),
    snapshotBytes: v.bytes(), // V2 encoded snapshot
    snapshotVersion: v.number(), // Version at snapshot time
    createdTimestamp: v.number(),
    expiresAt: v.number(), // Auto-cleanup timestamp
  })
    .index('by_collection_document', ['collectionName', 'documentId'])
    .index('by_expires', ['expiresAt']),

  // Migration definitions (type-safe function references)
  migrations: defineTable({
    version: v.number(), // Target schema version (e.g., 2 for v1→v2 migration)
    collectionName: v.string(), // Collection this migration applies to
    functionName: v.string(), // Function name extracted via getFunctionName()
    createdAt: v.number(),
  }).index('by_collection_version', ['collectionName', 'version']),
});
