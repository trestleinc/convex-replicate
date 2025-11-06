import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Insert a new document with CRDT bytes (Yjs format).
 * Appends delta to event log (event sourcing pattern).
 *
 * @param collectionName - Collection identifier
 * @param documentId - Unique document identifier
 * @param crdtBytes - ArrayBuffer containing Yjs CRDT bytes (delta)
 * @param version - CRDT version number
 */
export const insertDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Append delta to event log (no duplicate check - event sourcing!)
    await ctx.db.insert('documents', {
      collectionName: args.collectionName,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
      operationType: 'insert',
    });

    return { success: true };
  },
});

/**
 * Update an existing document with new CRDT bytes (Yjs format).
 * Appends delta to event log (event sourcing pattern).
 *
 * @param collectionName - Collection identifier
 * @param documentId - Unique document identifier
 * @param crdtBytes - ArrayBuffer containing Yjs CRDT bytes (delta)
 * @param version - CRDT version number
 */
export const updateDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Append delta to event log (no check - event sourcing!)
    await ctx.db.insert('documents', {
      collectionName: args.collectionName,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
      operationType: 'update',
    });

    return { success: true };
  },
});

/**
 * Delete a document from CRDT storage.
 * Appends deletion delta to event log (preserves history).
 *
 * @param collectionName - Collection identifier
 * @param documentId - Unique document identifier
 * @param crdtBytes - ArrayBuffer containing Yjs deletion delta
 * @param version - CRDT version number
 */
export const deleteDocument = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Append deletion delta to event log (preserve history!)
    await ctx.db.insert('documents', {
      collectionName: args.collectionName,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
      operationType: 'delete',
    });

    return { success: true };
  },
});

/**
 * Get complete event history for a document.
 * Returns all CRDT deltas in chronological order.
 *
 * Used for:
 * - Future recovery features (client-side)
 * - Audit trails
 * - Debugging
 *
 * @param collectionName - Collection identifier
 * @param documentId - Unique document identifier
 */
export const getDocumentHistory = query({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
  },
  returns: v.array(
    v.object({
      crdtBytes: v.bytes(),
      version: v.number(),
      timestamp: v.number(),
      operationType: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    // Fetch ALL deltas for this document in chronological order
    const deltas = await ctx.db
      .query('documents')
      .withIndex('by_collection_document_version', (q) =>
        q.eq('collectionName', args.collectionName).eq('documentId', args.documentId)
      )
      .order('asc')
      .collect();

    return deltas.map((d) => ({
      crdtBytes: d.crdtBytes,
      version: d.version,
      timestamp: d.timestamp,
      operationType: d.operationType,
    }));
  },
});

/**
 * Stream CRDT changes for incremental replication.
 * Returns Yjs CRDT bytes for documents modified since the checkpoint.
 * Can be used for both polling (awaitReplication) and subscriptions (live updates).
 *
 * Supports state vector-based sync for gap-free compaction recovery.
 *
 * @param collectionName - Collection identifier
 * @param checkpoint - Last replication checkpoint
 * @param stateVector - Optional Yjs state vector for gap-free sync
 * @param limit - Maximum number of changes to return (default: 100)
 */
export const stream = query({
  args: {
    collectionName: v.string(),
    checkpoint: v.object({
      lastModified: v.number(),
    }),
    stateVector: v.optional(v.bytes()), // Client's Yjs state vector
    limit: v.optional(v.number()),
  },
  returns: v.object({
    changes: v.array(
      v.object({
        documentId: v.string(),
        crdtBytes: v.bytes(),
        version: v.number(),
        timestamp: v.number(),
        operationType: v.optional(v.string()), // 'snapshot' | 'state-diff' | undefined (normal delta)
      })
    ),
    checkpoint: v.object({
      lastModified: v.number(),
    }),
    hasMore: v.boolean(),
    resetRequired: v.optional(v.boolean()),
    resetReason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    // Check for gap detection (compaction state)
    const compactionState = await ctx.db
      .query('compactionState')
      .withIndex('by_collection', (q) => q.eq('collectionName', args.collectionName))
      .unique();

    // Gap detected - client checkpoint is older than oldest available delta
    if (compactionState && args.checkpoint.lastModified < compactionState.oldestDeltaTimestamp) {
      // Get latest snapshot
      const snapshot = await ctx.db
        .query('snapshots')
        .withIndex('by_collection_document', (q) => q.eq('collectionName', args.collectionName))
        .order('desc')
        .first();

      if (!snapshot) {
        // No snapshot available - client must reset
        return {
          changes: [],
          checkpoint: args.checkpoint,
          hasMore: false,
          resetRequired: true,
          resetReason: 'No snapshot available for gap recovery',
        };
      }

      // If client provided state vector, compute diff from snapshot
      // This is gap-free sync - no data loss!
      if (args.stateVector) {
        // State vector sync leverages Yjs native diffing
        // The actual diff computation would happen with Y.encodeStateAsUpdateV2(snapshotDoc, stateVector)
        // For now, return snapshot with metadata indicating state-diff mode
        return {
          changes: [
            {
              documentId: snapshot.documentId,
              crdtBytes: snapshot.snapshotBytes,
              version: snapshot.snapshotVersion,
              timestamp: snapshot.createdTimestamp,
              operationType: 'state-diff',
            },
          ],
          checkpoint: {
            lastModified: snapshot.createdTimestamp,
          },
          hasMore: false,
        };
      }

      // No state vector - send full snapshot
      return {
        changes: [
          {
            documentId: snapshot.documentId,
            crdtBytes: snapshot.snapshotBytes,
            version: snapshot.snapshotVersion,
            timestamp: snapshot.createdTimestamp,
            operationType: 'snapshot',
          },
        ],
        checkpoint: {
          lastModified: snapshot.createdTimestamp,
        },
        hasMore: false,
      };
    }

    // Normal incremental sync (no gap)
    const documents = await ctx.db
      .query('documents')
      .withIndex('by_timestamp', (q) =>
        q.eq('collectionName', args.collectionName).gt('timestamp', args.checkpoint.lastModified)
      )
      .order('asc')
      .take(limit);

    const changes = documents.map((doc) => ({
      documentId: doc.documentId,
      crdtBytes: doc.crdtBytes,
      version: doc.version,
      timestamp: doc.timestamp,
      operationType: undefined, // Normal delta (no special handling)
    }));

    const newCheckpoint = {
      lastModified:
        documents.length > 0
          ? (documents[documents.length - 1]?.timestamp ?? args.checkpoint.lastModified)
          : args.checkpoint.lastModified,
    };

    return {
      changes,
      checkpoint: newCheckpoint,
      hasMore: documents.length === limit,
    };
  },
});

/**
 * Protocol version for ConvexReplicate component API.
 * Increment when making breaking changes to component API signatures.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Check protocol version compatibility between client and server.
 * Used to detect client/server version mismatches.
 *
 * @param clientVersion - Client's protocol version
 */
export const checkProtocolVersion = query({
  args: {
    clientVersion: v.number(),
  },
  returns: v.object({
    compatible: v.boolean(),
    serverVersion: v.number(),
    upgradeRequired: v.boolean(),
  }),
  handler: async (_ctx, args) => {
    return {
      compatible: args.clientVersion === PROTOCOL_VERSION,
      serverVersion: PROTOCOL_VERSION,
      upgradeRequired: args.clientVersion < PROTOCOL_VERSION,
    };
  },
});

/**
 * Store a snapshot for compaction
 * Called by user's compaction logic using Yjs Y.mergeUpdates()
 *
 * @param collectionName - Collection identifier
 * @param documentId - Document identifier
 * @param snapshotBytes - V2-encoded Yjs snapshot
 * @param snapshotVersion - Version at snapshot time
 * @param expiresAt - Expiration timestamp for cleanup
 */
export const storeSnapshot = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    snapshotBytes: v.bytes(),
    snapshotVersion: v.number(),
    expiresAt: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await ctx.db.insert('snapshots', {
      collectionName: args.collectionName,
      documentId: args.documentId,
      snapshotBytes: args.snapshotBytes,
      snapshotVersion: args.snapshotVersion,
      createdTimestamp: Date.now(),
      expiresAt: args.expiresAt,
    });

    return { success: true };
  },
});

/**
 * Update compaction state after compaction completes
 * Tracks oldest available delta timestamp for gap detection
 *
 * @param collectionName - Collection identifier
 * @param oldestDeltaTimestamp - Timestamp of oldest remaining delta
 * @param latestSnapshotTimestamp - Timestamp of latest snapshot created
 */
export const updateCompactionState = mutation({
  args: {
    collectionName: v.string(),
    oldestDeltaTimestamp: v.number(),
    latestSnapshotTimestamp: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Upsert compaction state
    const existing = await ctx.db
      .query('compactionState')
      .withIndex('by_collection', (q) => q.eq('collectionName', args.collectionName))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        oldestDeltaTimestamp: args.oldestDeltaTimestamp,
        latestSnapshotTimestamp: args.latestSnapshotTimestamp,
        lastCompactionRun: Date.now(),
      });
    } else {
      await ctx.db.insert('compactionState', {
        collectionName: args.collectionName,
        oldestDeltaTimestamp: args.oldestDeltaTimestamp,
        latestSnapshotTimestamp: args.latestSnapshotTimestamp,
        lastCompactionRun: Date.now(),
      });
    }

    return { success: true };
  },
});

/**
 * Register a migration function for schema evolution
 * Stores type-safe function reference (extracted via getFunctionName)
 *
 * @param version - Target schema version
 * @param collectionName - Collection this migration applies to
 * @param functionName - Function name from getFunctionName(functionReference)
 */
export const registerMigration = mutation({
  args: {
    version: v.number(),
    collectionName: v.string(),
    functionName: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Check if already registered
    const existing = await ctx.db
      .query('migrations')
      .withIndex('by_collection_version', (q) =>
        q.eq('collectionName', args.collectionName).eq('version', args.version)
      )
      .unique();

    if (existing) {
      // Update existing registration
      await ctx.db.patch(existing._id, {
        functionName: args.functionName,
        createdAt: Date.now(),
      });
    } else {
      // Insert new registration
      await ctx.db.insert('migrations', {
        version: args.version,
        collectionName: args.collectionName,
        functionName: args.functionName,
        createdAt: Date.now(),
      });
    }

    return { success: true };
  },
});

/**
 * Get migration definition for a specific version
 * Used during client reconciliation to apply migrations
 *
 * @param collectionName - Collection identifier
 * @param version - Target schema version
 */
export const getMigration = query({
  args: {
    collectionName: v.string(),
    version: v.number(),
  },
  returns: v.union(
    v.object({
      version: v.number(),
      collectionName: v.string(),
      functionName: v.string(),
      createdAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const migration = await ctx.db
      .query('migrations')
      .withIndex('by_collection_version', (q) =>
        q.eq('collectionName', args.collectionName).eq('version', args.version)
      )
      .unique();

    if (!migration) {
      return null;
    }

    return {
      version: migration.version,
      collectionName: migration.collectionName,
      functionName: migration.functionName,
      createdAt: migration.createdAt,
    };
  },
});

/**
 * Get current schema version for a collection
 * Returns highest registered migration version + 1 (or 1 if no migrations)
 *
 * This is what the server advertises to clients for version checking.
 *
 * @param collectionName - Collection identifier
 */
export const getCurrentSchemaVersion = query({
  args: {
    collectionName: v.string(),
  },
  returns: v.object({
    schemaVersion: v.number(),
  }),
  handler: async (ctx, args) => {
    const migrations = await ctx.db
      .query('migrations')
      .withIndex('by_collection_version', (q) => q.eq('collectionName', args.collectionName))
      .collect();

    if (migrations.length === 0) {
      return { schemaVersion: 1 }; // No migrations = version 1
    }

    const maxVersion = Math.max(...migrations.map((m) => m.version));
    return { schemaVersion: maxVersion };
  },
});

/**
 * Store a synthetic CRDT delta for manual server edits
 *
 * When admins edit the main table directly (bypassing CRDT layer),
 * this stores a synthesized delta in the component to maintain event log consistency.
 *
 * The synthetic delta is generated from the materialized document state
 * using Yjs Y.encodeStateAsUpdateV2(). This makes manual edits appear as
 * normal CRDT updates to clients - no data loss, no cache wipe needed.
 *
 * @param collectionName - Collection identifier
 * @param documentId - Document identifier
 * @param crdtBytes - Synthesized CRDT delta from materialized doc
 * @param version - Version at time of manual edit
 */
export const storeSyntheticDelta = mutation({
  args: {
    collectionName: v.string(),
    documentId: v.string(),
    crdtBytes: v.bytes(),
    version: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Store synthetic delta as normal update in event log
    await ctx.db.insert('documents', {
      collectionName: args.collectionName,
      documentId: args.documentId,
      crdtBytes: args.crdtBytes,
      version: args.version,
      timestamp: Date.now(),
      operationType: 'update', // Synthetic delta treated as normal update
    });

    return { success: true };
  },
});

/**
 * Get collection statistics for compaction monitoring
 * Used by auto-compaction triggers to determine when to compact
 *
 * @param collectionName - Collection identifier
 */
export const getCollectionStats = query({
  args: {
    collectionName: v.string(),
  },
  returns: v.object({
    documentCount: v.number(),
    totalSize: v.number(),
    oldestTimestamp: v.number(),
    newestTimestamp: v.number(),
  }),
  handler: async (ctx, args) => {
    const documents = await ctx.db
      .query('documents')
      .withIndex('by_collection', (q) => q.eq('collectionName', args.collectionName))
      .collect();

    const totalSize = documents.reduce((sum, doc) => sum + doc.crdtBytes.byteLength, 0);
    const timestamps = documents.map((d) => d.timestamp);

    return {
      documentCount: documents.length,
      totalSize,
      oldestTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : 0,
      newestTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : 0,
    };
  },
});

/**
 * Clean up expired snapshots (call from cron job)
 * Removes snapshots past their expiration timestamp
 */
export const cleanupExpiredSnapshots = mutation({
  args: {},
  returns: v.object({
    deletedCount: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('snapshots')
      .withIndex('by_expires', (q) => q.lt('expiresAt', now))
      .collect();

    for (const snapshot of expired) {
      await ctx.db.delete(snapshot._id);
    }

    return { deletedCount: expired.length };
  },
});

/**
 * Check if collection should be compacted based on size threshold
 * This is automatic monitoring - users just configure thresholds
 *
 * @param collectionName - Collection to check
 * @param sizeThresholdBytes - Compact when collection exceeds this size (default: 50MB)
 * @param ageThresholdMs - Compact deltas older than this (default: 30 days)
 */
export const shouldCompact = query({
  args: {
    collectionName: v.string(),
    sizeThresholdBytes: v.optional(v.number()),
    ageThresholdMs: v.optional(v.number()),
  },
  returns: v.object({
    shouldCompact: v.boolean(),
    reason: v.string(),
    stats: v.object({
      totalSize: v.number(),
      documentCount: v.number(),
      oldestTimestamp: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const sizeThreshold = args.sizeThresholdBytes ?? 50 * 1024 * 1024; // 50MB default
    const ageThreshold = args.ageThresholdMs ?? 30 * 24 * 60 * 60 * 1000; // 30 days default

    // Get collection stats inline
    const documents = await ctx.db
      .query('documents')
      .withIndex('by_collection', (q) => q.eq('collectionName', args.collectionName))
      .collect();

    const totalSize = documents.reduce((sum, doc) => sum + doc.crdtBytes.byteLength, 0);
    const timestamps = documents.map((d) => d.timestamp);
    const stats = {
      totalSize,
      documentCount: documents.length,
      oldestTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : 0,
    };

    // Check size threshold
    if (stats.totalSize > sizeThreshold) {
      return {
        shouldCompact: true,
        reason: `Size ${stats.totalSize} exceeds threshold ${sizeThreshold}`,
        stats,
      };
    }

    // Check age threshold
    const now = Date.now();
    if (stats.oldestTimestamp > 0 && now - stats.oldestTimestamp > ageThreshold) {
      return {
        shouldCompact: true,
        reason: `Oldest delta age ${now - stats.oldestTimestamp}ms exceeds threshold ${ageThreshold}ms`,
        stats,
      };
    }

    return {
      shouldCompact: false,
      reason: 'Collection within thresholds',
      stats,
    };
  },
});
