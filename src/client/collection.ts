import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  startOfflineExecutor,
  NonRetriableError,
  type OfflineExecutor,
} from '@tanstack/offline-transactions';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import type { CollectionConfig, Collection } from '@tanstack/db';
import { getLogger } from './logger.js';
import { ensureInitialized } from './init.js';

const logger = getLogger(['convex-replicate', 'collection']);

// Re-export shared enum for type-safe operation type handling
export { OperationType } from '../component/shared.js';

// Global cleanup tracking to prevent subscription leaks
const cleanupFunctions = new Map<string, () => void>();

// Yjs transaction origins (local and remote)
export enum YjsOrigin {
  // Local mutations (from TanStack DB handlers)
  Insert = 'insert',
  Update = 'update',
  Delete = 'delete',

  // Remote subscription updates
  Subscription = 'subscription',
  Snapshot = 'snapshot',
  SSRInit = 'ssr-init', // SSR data loaded before IndexedDB
}

/**
 * SSR data format - enhanced format with documents + metadata + optional CRDT state
 */
export type SSRData<T> = {
  documents: ReadonlyArray<T>;
  checkpoint?: { lastModified: number };
  count?: number;
  crdtBytes?: ArrayBuffer; // CRDT state for Yjs initialization
};

/**
 * Configuration for convexCollectionOptions (Step 1)
 * All params go here - they'll be used to create the collection config
 */
export interface ConvexCollectionOptionsConfig<T extends object> {
  /** Function to extract unique key from items */
  getKey: (item: T) => string | number;

  /** Optional initial data to populate collection (enhanced format with documents + metadata) */
  initialData?: SSRData<T>;

  /** Convex client instance */
  convexClient: ConvexClient;

  /** Convex API functions for this collection */
  api: {
    stream: FunctionReference<'query'>; // For streaming data from main table (required)
    insertDocument: FunctionReference<'mutation'>; // Insert handler (required)
    updateDocument: FunctionReference<'mutation'>; // Update handler (required)
    deleteDocument: FunctionReference<'mutation'>; // Delete handler (required)
    getProtocolVersion?: FunctionReference<'query'>; // Protocol version check (optional)
    ssrQuery?: FunctionReference<'query'>; // For reconciliation - fetches current main table state (optional but recommended)
  };

  /** Unique collection name */
  collection: string;

  /** Optional metadata to pass with mutations (e.g., schema version for migrations) */
  metadata?: {
    schemaVersion?: number; // Client schema version for migration support
  };
}

/**
 * ConvexCollection is now just a standard TanStack DB Collection!
 * No custom wrapper, no special methods - uses built-in transaction system.
 */
export type ConvexCollection<T extends object> = Collection<T>;

/**
 * Step 1: Create TanStack DB CollectionConfig with REAL mutation handlers.
 *
 * This implements the CORRECT pattern:
 * - Uses onInsert/onUpdate/onDelete handlers (not custom wrapper)
 * - Yjs Y.Doc with 'update' event for delta encoding
 * - Stores Y.Map instances (not plain objects) for field-level CRDT
 * - Uses ydoc.transact() to batch changes into single 'update' event
 *
 * @example
 * ```typescript
 * import { createCollection } from '@tanstack/react-db'
 * import { convexCollectionOptions } from '@trestleinc/convex-replicate-core'
 *
 * const rawCollection = createCollection(
 *   convexCollectionOptions<Task>({
 *     convexClient,
 *     api: api.tasks,
 *     collection: 'tasks',
 *     getKey: (task) => task.id,
 *     initialData,
 *   })
 * )
 * ```
 */
export function convexCollectionOptions<T extends object>({
  getKey,
  initialData,
  convexClient,
  api,
  collection,
  metadata,
}: ConvexCollectionOptionsConfig<T>): CollectionConfig<T> & {
  _convexClient: ConvexClient;
  _collection: string;
} {
  // Trigger lazy initialization (runs once globally)
  // This will check protocol version and run migrations if needed
  const initPromise = ensureInitialized({
    convexClient,
    api: api.getProtocolVersion ? { getProtocolVersion: api.getProtocolVersion } : undefined,
  });

  // ═══════════════════════════════════════════════════════════
  // LAYER 2: Yjs + IndexedDB Persistence (Source of Truth)
  // ═══════════════════════════════════════════════════════════

  // Generate or load stable client ID for this collection
  // CRITICAL: Client ID must be stable across page refreshes to maintain CRDT causality
  // Without this, Yjs will reject deltas from other clients after refresh due to Item ID mismatches
  const clientIdKey = `convex-replicate:yjsClientId:${collection}`;
  let clientId = Number.parseInt(localStorage.getItem(clientIdKey) || '0', 10);
  if (!clientId) {
    // Generate random client ID in valid Yjs range (0 to 2^31-1)
    clientId = Math.floor(Math.random() * 2147483647);
    localStorage.setItem(clientIdKey, clientId.toString());
  }

  // Initialize Yjs document with persistent IndexedDB storage and stable client ID
  // Note: Using type assertion because Yjs types don't expose clientID option in TypeScript
  const ydoc = new Y.Doc({ guid: collection, clientID: clientId } as any);
  const ymap = ydoc.getMap(collection);

  // Create IndexedDB persistence provider
  const persistence = new IndexeddbPersistence(collection, ydoc);

  // Track persistence initialization
  const persistenceReadyPromise = new Promise<void>((resolve) => {
    persistence.on('synced', () => {
      resolve();
    });
  });

  // Track delta updates for Convex sync (NOT full state)
  // This is the key to efficient bandwidth usage: < 1KB per change instead of 100KB+
  // Using V2 encoding for 30-50% better compression than V1
  let pendingUpdate: Uint8Array | null = null;
  (ydoc as any).on('updateV2', (update: Uint8Array, origin: any) => {
    // Only capture LOCAL mutations (ignore remote subscription updates)
    // Remote updates should NOT be re-sent to Convex
    if (origin === YjsOrigin.Insert || origin === YjsOrigin.Update || origin === YjsOrigin.Delete) {
      // `update` contains ONLY what changed (delta) in V2 format
      pendingUpdate = update;
    }
  });

  // Store TanStack DB sync methods for direct writes
  // Used during snapshot restore to sync Yjs state to TanStack DB
  let syncParams: any = null;

  /**
   * Reconcile Yjs state with main table.
   * Removes documents from Yjs that don't exist in main table.
   * This handles the case where component event log has full history
   * of deleted documents, causing clients to reconstruct items that shouldn't exist.
   */
  const reconcileWithMainTable = async (): Promise<void> => {
    if (!api.ssrQuery) {
      return;
    }

    try {
      // Query main table for documents that currently exist
      const serverResponse = await convexClient.query(api.ssrQuery, {});
      // Handle both legacy array format and enhanced format with crdtBytes
      const serverDocs = Array.isArray(serverResponse)
        ? serverResponse
        : ((serverResponse as any).documents as T[] | undefined) || [];
      const serverDocIds = new Set(serverDocs.map((doc) => String(getKey(doc))));

      // Find Yjs documents that don't exist in main table
      const toDelete: string[] = [];
      ymap.forEach((_itemYMap, key) => {
        if (!serverDocIds.has(key)) {
          toDelete.push(key);
        }
      });

      if (toDelete.length > 0) {
        // Capture data BEFORE deleting from Yjs
        // This is necessary because Yjs garbage collects deleted content
        // and we need the full item data for TanStack DB's delete handler
        const deletedItems: Array<{ key: string; item: T }> = [];
        for (const key of toDelete) {
          const itemYMap = ymap.get(key);
          if (itemYMap instanceof Y.Map) {
            deletedItems.push({ key, item: itemYMap.toJSON() as T });
          }
        }

        // Remove from Yjs
        ydoc.transact(() => {
          for (const key of toDelete) {
            ymap.delete(key);
          }
        }, 'reconciliation');

        // Sync deletes to TanStack DB using captured data
        if (deletedItems.length > 0 && syncParams) {
          const { begin, write, commit } = syncParams;
          try {
            begin();
            for (const { item } of deletedItems) {
              write({ type: 'delete', value: item });
            }
            commit();
          } catch (error) {
            logger.error('Reconciliation: failed to delete from TanStack DB', {
              collection,
              error,
            });
          }
        }
      }
    } catch (error) {
      logger.error('Reconciliation failed', {
        collection,
        error,
      });
    }
  };

  return {
    id: collection,
    getKey,

    // Store for extraction by createConvexCollection
    _convexClient: convexClient,
    _collection: collection,

    // REAL onInsert handler (called automatically by TanStack DB)
    onInsert: async ({ transaction }: any) => {
      try {
        await Promise.all([initPromise, persistenceReadyPromise]);

        // Update Yjs in transaction
        ydoc.transact(() => {
          transaction.mutations.forEach((mut: any) => {
            const itemYMap = new Y.Map();
            Object.entries(mut.modified as Record<string, unknown>).forEach(([k, v]) => {
              itemYMap.set(k, v);
            });
            ymap.set(String(mut.key), itemYMap);
          });
        }, YjsOrigin.Insert);

        // Send DELTA to Convex
        if (pendingUpdate) {
          const documentKey = String(transaction.mutations[0].key);
          const mutationArgs: any = {
            documentId: documentKey,
            crdtBytes: pendingUpdate.slice().buffer,
            materializedDoc: transaction.mutations[0].modified,
            version: Date.now(),
          };

          if (metadata?.schemaVersion !== undefined) {
            mutationArgs._schemaVersion = metadata.schemaVersion;
          }

          await convexClient.mutation(api.insertDocument, mutationArgs);
          pendingUpdate = null;
        }
      } catch (error: any) {
        logger.error('Insert failed', {
          collection,
          error: error?.message,
          status: error?.status,
        });

        // Classify errors for retry behavior
        if (error?.status === 401 || error?.status === 403) {
          throw new NonRetriableError('Authentication failed');
        }
        if (error?.status === 422) {
          throw new NonRetriableError('Validation error');
        }

        // Network errors retry automatically
        throw error;
      }
    },

    // REAL onUpdate handler (called automatically by TanStack DB)
    onUpdate: async ({ transaction }: any) => {
      try {
        // Wait for BOTH initialization AND IndexedDB persistence
        await Promise.all([initPromise, persistenceReadyPromise]);

        // Update Yjs in transaction
        ydoc.transact(() => {
          transaction.mutations.forEach((mut: any) => {
            const itemYMap = ymap.get(String(mut.key)) as Y.Map<any> | undefined;
            if (itemYMap) {
              // Update only changed fields (field-level CRDT)
              const modifiedFields = mut.modified as Record<string, unknown>;
              if (!modifiedFields) {
                logger.warn('mut.modified is null/undefined', {
                  collection,
                  key: String(mut.key),
                });
                return;
              }
              Object.entries(modifiedFields).forEach(([k, v]) => {
                itemYMap.set(k, v);
              });
            } else {
              // Item should exist for update - if not, skip (don't create with wrong IDs)
              logger.error('Update attempted on non-existent item - skipping', {
                collection,
                key: String(mut.key),
              });
              return;
            }
          });
        }, YjsOrigin.Update);

        // Send delta to Convex
        if (pendingUpdate) {
          const documentKey = String(transaction.mutations[0].key);
          const itemYMap = ymap.get(documentKey) as Y.Map<any>;
          const fullDoc = itemYMap ? itemYMap.toJSON() : transaction.mutations[0].modified;

          const mutationArgs: any = {
            documentId: documentKey,
            crdtBytes: pendingUpdate.slice().buffer,
            materializedDoc: fullDoc,
            version: Date.now(),
          };

          if (metadata?.schemaVersion !== undefined) {
            mutationArgs._schemaVersion = metadata.schemaVersion;
          }

          await convexClient.mutation(api.updateDocument, mutationArgs);
          pendingUpdate = null;
        } else {
          logger.warn('pendingUpdate is null - no delta to send', {
            collection,
          });
        }
      } catch (error: any) {
        logger.error('Update failed', {
          collection,
          error: error?.message,
          status: error?.status,
        });

        // Classify errors
        if (error?.status === 401 || error?.status === 403) {
          throw new NonRetriableError('Authentication failed');
        }
        if (error?.status === 422) {
          throw new NonRetriableError('Validation error');
        }

        throw error;
      }
    },

    // onDelete handler (called when user does collection.delete())
    onDelete: async ({ transaction }: any) => {
      try {
        await Promise.all([initPromise, persistenceReadyPromise]);

        // Remove from Yjs Y.Map - creates deletion tombstone
        ydoc.transact(() => {
          transaction.mutations.forEach((mut: any) => {
            ymap.delete(String(mut.key));
          });
        }, YjsOrigin.Delete);

        // Update TanStack DB data layer immediately to prevent re-appearance
        if (syncParams) {
          const { begin, write, commit } = syncParams;
          try {
            begin();
            transaction.mutations.forEach((mut: any) => {
              write({ type: 'delete', value: mut.original });
            });
            commit();
          } catch (error) {
            logger.error('TanStack DB delete failed', {
              collection,
              error,
            });
          }
        }

        // Send deletion DELTA to Convex
        if (pendingUpdate) {
          const documentKey = String(transaction.mutations[0].key);
          const mutationArgs: any = {
            documentId: documentKey,
            crdtBytes: pendingUpdate.slice().buffer,
            version: Date.now(),
          };

          if (metadata?.schemaVersion !== undefined) {
            mutationArgs._schemaVersion = metadata.schemaVersion;
          }

          await convexClient.mutation(api.deleteDocument, mutationArgs);
          pendingUpdate = null;
        }
      } catch (error: any) {
        logger.error('Delete operation failed', {
          collection,
          error: error?.message,
          status: error?.status,
        });

        if (error?.status === 401 || error?.status === 403) {
          throw new NonRetriableError('Authentication failed');
        }
        if (error?.status === 422) {
          throw new NonRetriableError('Validation error');
        }

        throw error;
      }
    },

    // Sync function for pulling data from server
    sync: {
      rowUpdateMode: 'full', // We send complete documents from Yjs, not partial updates
      sync: (params: any) => {
        const { markReady } = params;

        // Clean up any existing collection instance for this collection
        // This prevents subscription leaks when collections are recreated (e.g., during HMR)
        const existingCleanup = cleanupFunctions.get(collection);
        if (existingCleanup) {
          existingCleanup();
          cleanupFunctions.delete(collection);
        }

        // Store TanStack DB sync methods for snapshot restore
        syncParams = params;

        // Initialize subscription variable
        let subscription: (() => void) | null = null;

        // Declare SSR variables
        let ssrDocuments: ReadonlyArray<T> | undefined;
        let ssrCheckpoint: { lastModified: number } | undefined;
        let ssrCRDTBytes: ArrayBuffer | undefined;

        // Parse initialData if provided
        if (initialData) {
          ssrDocuments = initialData.documents;
          ssrCheckpoint = initialData.checkpoint;
          ssrCRDTBytes = initialData.crdtBytes;
        }

        // NEW: Collect items for TanStack DB - defined in sync function scope
        const initialItemsForTanStack: T[] = ssrDocuments ? [...ssrDocuments] : [];

        // Checkpoint persistence helpers
        const checkpointKey = `convex-replicate:checkpoint:${collection}`;
        const loadCheckpoint = (): { lastModified: number } => {
          try {
            const stored = localStorage.getItem(checkpointKey);
            if (stored) {
              return JSON.parse(stored);
            }
          } catch (error) {
            logger.warn('Failed to load checkpoint from localStorage', { error });
          }
          return { lastModified: 0 };
        };

        const saveCheckpoint = (checkpoint: { lastModified: number }) => {
          try {
            localStorage.setItem(checkpointKey, JSON.stringify(checkpoint));
          } catch (error) {
            logger.warn('Failed to save checkpoint to localStorage', { error });
          }
        };

        // Start async initialization + data loading + subscription
        (async () => {
          try {
            // ═══════════════════════════════════════════════════════
            // STEP 1: Wait for initialization AND IndexedDB to load
            // ═══════════════════════════════════════════════════════
            await Promise.all([initPromise, persistenceReadyPromise]);

            // ═══════════════════════════════════════════════════════
            // CRITICAL: If SSR includes CRDT bytes, apply to Yjs FIRST
            // This ensures late-joining clients get correct Item IDs
            // ═══════════════════════════════════════════════════════
            if (ssrCRDTBytes) {
              // Apply CRDT bytes to Yjs (preserves original Item IDs)
              Y.applyUpdateV2(ydoc, new Uint8Array(ssrCRDTBytes), YjsOrigin.SSRInit);

              // Save checkpoint so subscription starts from correct point
              if (ssrCheckpoint) {
                saveCheckpoint(ssrCheckpoint);
              }
            }

            // ═══════════════════════════════════════════════════════
            // STEP 3: Reconcile with main table
            // Remove any documents from Yjs that don't exist in main table
            // This handles deleted documents whose deltas are still in component
            // ═══════════════════════════════════════════════════════
            await reconcileWithMainTable();

            // ═══════════════════════════════════════════════════════
            // STEP 5: Set up Convex subscription for real-time sync
            // ═══════════════════════════════════════════════════════

            // Set up subscription with checkpoint-based incremental sync
            try {
              subscription = convexClient.onUpdate(
                api.stream,
                {
                  checkpoint:
                    initialItemsForTanStack.length > 0 ? { lastModified: 0 } : loadCheckpoint(),
                  limit: 100,
                },
                async (response) => {
                  const { changes, checkpoint: newCheckpoint } = response;

                  for (const change of changes) {
                    const { operationType, crdtBytes, documentId } = change;

                    switch (operationType) {
                      case 'snapshot': {
                        // Apply snapshot to Yjs
                        Y.applyUpdateV2(ydoc, new Uint8Array(crdtBytes), YjsOrigin.Snapshot);

                        // Clear TanStack DB before syncing snapshot to avoid conflicts
                        const {
                          truncate,
                          begin: snapshotBegin,
                          write: snapshotWrite,
                          commit: snapshotCommit,
                        } = syncParams;

                        truncate(); // Clear existing data

                        snapshotBegin();
                        ymap.forEach((itemYMap) => {
                          if (itemYMap instanceof Y.Map) {
                            snapshotWrite({ type: 'insert', value: itemYMap.toJSON() });
                          }
                        });
                        snapshotCommit();
                        break;
                      }

                      default: {
                        // Capture item data BEFORE applying delta
                        let itemBeforeDelta: T | null = null;
                        if (documentId) {
                          const itemYMapBefore = ymap.get(documentId);
                          if (itemYMapBefore instanceof Y.Map) {
                            itemBeforeDelta = itemYMapBefore.toJSON() as T;
                          }
                        }

                        // Apply delta to Yjs
                        Y.applyUpdateV2(ydoc, new Uint8Array(crdtBytes), YjsOrigin.Subscription);

                        // Sync affected document to TanStack DB
                        if (documentId) {
                          const itemYMap = ymap.get(documentId);
                          if (itemYMap instanceof Y.Map) {
                            // Item EXISTS after delta - UPDATE or INSERT
                            const { begin, write, commit } = syncParams;
                            const item = itemYMap.toJSON() as T;

                            begin();
                            try {
                              write({ type: 'update', value: item });
                              commit();
                            } catch {
                              write({ type: 'insert', value: item });
                              commit();
                            }
                          } else if (itemBeforeDelta) {
                            // Item DELETED by delta
                            const { begin, write, commit } = syncParams;
                            try {
                              begin();
                              write({ type: 'delete', value: itemBeforeDelta });
                              commit();
                            } catch (error) {
                              logger.error('Subscription delete failed', {
                                collection,
                                documentId,
                                error,
                              });
                            }
                          }
                        }
                        break;
                      }
                    }
                  }

                  // Save checkpoint
                  saveCheckpoint(newCheckpoint);
                }
              );
            } catch (subscriptionError) {
              logger.error('Failed to setup subscription', {
                collection,
                error: subscriptionError,
              });
              throw subscriptionError;
            }

            // Mark collection as ready
            markReady();
          } catch (error) {
            logger.error('Failed to initialize collection', { error, collection });
            markReady(); // Mark ready anyway to avoid blocking
          }
        })();

        // Return initial data and cleanup function
        return {
          initialData: initialItemsForTanStack,
          cleanup: () => {
            // Cleanup subscription
            if (subscription) {
              subscription();
            }

            // Cleanup IndexedDB persistence connection
            persistence.destroy();

            // Track cleanup for HMR
            cleanupFunctions.delete(collection);
          },
        };
      },
    },
  };
}

/**
 * ═══════════════════════════════════════════════════════════
 * LAYER 1: Offline Reconnect (Retry Layer)
 * ═══════════════════════════════════════════════════════════
 *
 * Wraps a TanStack DB collection with offline reconnect capabilities.
 * Queues failed mutations and retries them when connection is restored.
 *
 * This layer does NOT handle storage - that's Yjs IndexedDB's job.
 * It ONLY handles retry logic and leadership coordination.
 *
 * Architecture:
 * - Wraps collection ONCE with startOfflineExecutor
 * - Returns raw collection (NO CUSTOM WRAPPER)
 * - Uses beforeRetry filter for stale transactions
 * - Connects to Convex connection state for retry triggers
 *
 * Config is automatically extracted from the rawCollection!
 *
 * @example
 * ```typescript
 * import { createCollection } from '@tanstack/react-db'
 * import { convexCollectionOptions, handleReconnect } from '@trestleinc/replicate/client'
 *
 * // Layer 3: TanStack DB (reactive queries)
 * // Layer 2: Yjs + IndexedDB (source of truth) - configured via convexCollectionOptions
 * const rawCollection = createCollection(
 *   convexCollectionOptions<Task>({
 *     convexClient,
 *     api: {
 *       stream: api.tasks.stream,
 *       insertDocument: api.tasks.insertDocument,
 *       updateDocument: api.tasks.updateDocument,
 *       deleteDocument: api.tasks.deleteDocument,
 *       getProtocolVersion: api.tasks.getProtocolVersion,
 *     },
 *     collection: 'tasks',
 *     getKey: (task) => task.id,
 *     initialData,
 *   })
 * )
 *
 * // Layer 1: Offline reconnect (retry layer)
 * const collection = handleReconnect(rawCollection)
 *
 * // Use like a normal TanStack DB collection
 * const tx = collection.insert({ id: '1', text: 'Buy milk', isCompleted: false })
 * await tx.isPersisted.promise  // Built-in promise (not custom awaitReplication)
 * ```
 */
export function handleReconnect<T extends object>(
  rawCollection: Collection<T>
): ConvexCollection<T> {
  // Extract config from rawCollection
  const config = (rawCollection as any).config;
  const convexClient = config._convexClient;
  const collection = config._collection;

  if (!convexClient || !collection) {
    throw new Error(
      'handleReconnect requires a collection created with convexCollectionOptions. ' +
        'Make sure you pass convexClient and collection to convexCollectionOptions.'
    );
  }

  // Create offline executor (wraps collection ONCE)
  const offline: OfflineExecutor = startOfflineExecutor({
    collections: { [collection]: rawCollection as any },

    // Empty mutationFns - handlers in collection config will be used
    mutationFns: {},

    // Filter stale transactions before retry
    beforeRetry: (transactions) => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
      const filtered = transactions.filter((tx) => {
        const isRecent = tx.createdAt.getTime() > cutoff;
        const notExhausted = tx.retryCount < 10;
        return isRecent && notExhausted;
      });

      if (filtered.length < transactions.length) {
        logger.warn('Filtered stale transactions', {
          collection,
          before: transactions.length,
          after: filtered.length,
        });
      }

      return filtered;
    },

    onLeadershipChange: (_isLeader) => {
      // Leadership changed
    },

    onStorageFailure: (diagnostic) => {
      logger.warn('Storage failed - online-only mode', {
        collection,
        code: diagnostic.code,
        message: diagnostic.message,
      });
    },
  });

  // Trigger retry when connection is restored
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      offline.notifyOnline();
    });
  }

  // Return collection directly - NO WRAPPER!
  // Users call collection.insert/update/delete as normal
  // Handlers run automatically, offline-transactions handles persistence
  return rawCollection as ConvexCollection<T>;
}
