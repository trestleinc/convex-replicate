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
 * SSR data format - supports both legacy (array) and enhanced (object with metadata)
 */
export type SSRData<T> =
  | ReadonlyArray<T> // Legacy format: just array of documents
  | {
      // Enhanced format: documents + metadata + optional CRDT state
      documents: ReadonlyArray<T>;
      checkpoint?: { lastModified: number };
      count?: number;
      crdtBytes?: ArrayBuffer; // CRDT state for Yjs initialization
    };

/**
 * Type predicate to distinguish enhanced SSR format from legacy array format
 */
function isEnhancedSSRFormat<T>(data: SSRData<T>): data is {
  documents: ReadonlyArray<T>;
  checkpoint?: { lastModified: number };
  count?: number;
  crdtBytes?: ArrayBuffer;
} {
  return !Array.isArray(data) && 'documents' in data;
}

/**
 * Configuration for convexCollectionOptions (Step 1)
 * All params go here - they'll be used to create the collection config
 */
export interface ConvexCollectionOptionsConfig<T extends object> {
  /** Function to extract unique key from items */
  getKey: (item: T) => string | number;

  /** Optional initial data to populate collection (supports both legacy array and enhanced object formats) */
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
    logger.debug('Generated new stable client ID', { collection, clientId });
  } else {
    logger.debug('Loaded existing stable client ID', { collection, clientId });
  }

  // Initialize Yjs document with persistent IndexedDB storage and stable client ID
  // Note: Using type assertion because Yjs types don't expose clientID option in TypeScript
  const ydoc = new Y.Doc({ guid: collection, clientID: clientId } as any);
  const ymap = ydoc.getMap(collection);

  logger.info('Creating Yjs IndexedDB persistence', { collection });

  // Create IndexedDB persistence provider
  // This will merge cached data with existing Yjs state using CRDT semantics
  const persistence = new IndexeddbPersistence(collection, ydoc);

  // Track persistence initialization
  const persistenceReadyPromise = new Promise<void>((resolve) => {
    persistence.on('synced', () => {
      logger.info('Yjs IndexedDB persistence synced', {
        collection,
        documentCount: ymap.size,
        state: 'ready',
      });
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
      logger.debug('Yjs updateV2 event captured (local origin)', {
        collection,
        updateSize: update.length,
        origin,
      });
    } else {
      logger.debug('Yjs updateV2 event ignored (remote origin)', {
        collection,
        updateSize: update.length,
        origin,
      });
    }
  });

  logger.debug('Yjs persistence initialized', { collection });

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
      logger.debug('Skipping reconciliation - no SSR query configured', { collection });
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
        logger.info('Reconciliation: removing stale documents from Yjs', {
          collection,
          deleteCount: toDelete.length,
          deletedKeys: toDelete,
        });

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
            for (const { key, item } of deletedItems) {
              logger.debug('Reconciliation: deleting from TanStack DB', {
                collection,
                key,
                item,
              });
              write({ type: 'delete', value: item });
            }
            commit();

            logger.info('Reconciliation: deleted items from TanStack DB', {
              collection,
              deletedCount: deletedItems.length,
            });
          } catch (error) {
            logger.error('Reconciliation: failed to delete from TanStack DB', {
              collection,
              error,
            });
          }
        }

        logger.info('Reconciliation complete', {
          collection,
          removedCount: toDelete.length,
        });
      } else {
        logger.debug('Reconciliation: no stale documents found', {
          collection,
          yjsCount: ymap.size,
          serverCount: serverDocs.length,
        });
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
      logger.debug('onInsert handler called', {
        collection,
        mutationCount: transaction.mutations.length,
      });

      try {
        // Wait for BOTH initialization AND IndexedDB persistence
        await Promise.all([initPromise, persistenceReadyPromise]);

        // Update Yjs in transaction (batches multiple changes into ONE 'update' event)
        ydoc.transact(() => {
          transaction.mutations.forEach((mut: any) => {
            // Store as Y.Map for field-level CRDT conflict resolution
            const itemYMap = new Y.Map();
            Object.entries(mut.modified as Record<string, unknown>).forEach(([k, v]) => {
              itemYMap.set(k, v);
            });
            ymap.set(String(mut.key), itemYMap);
          });
        }, YjsOrigin.Insert);

        // Send DELTA to Convex (not full state)
        if (pendingUpdate) {
          logger.debug('Sending insert delta to Convex', {
            collection,
            documentId: String(transaction.mutations[0].key),
            deltaSize: pendingUpdate.length,
          });

          const documentKey = String(transaction.mutations[0].key);
          const mutationArgs: any = {
            documentId: documentKey,
            crdtBytes: pendingUpdate.slice().buffer, // Create clean copy to avoid byte offset issues
            materializedDoc: transaction.mutations[0].modified,
            version: Date.now(),
          };

          // Add schema version if metadata is provided
          if (metadata?.schemaVersion !== undefined) {
            mutationArgs._schemaVersion = metadata.schemaVersion;
          }

          await convexClient.mutation(api.insertDocument, mutationArgs);

          pendingUpdate = null;
          logger.info('Insert persisted to Convex', {
            collection,
            documentId: documentKey,
          });
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
      logger.debug('onUpdate handler called', {
        collection,
        mutationCount: transaction.mutations.length,
      });

      try {
        // Wait for BOTH initialization AND IndexedDB persistence
        await Promise.all([initPromise, persistenceReadyPromise]);

        // Log mutation details for debugging
        transaction.mutations.forEach((mut: any, index: number) => {
          logger.debug('Processing mutation', {
            collection,
            index,
            key: String(mut.key),
            modified: mut.modified,
            original: mut.original,
          });
        });

        // Log Yjs state BEFORE update
        transaction.mutations.forEach((mut: any) => {
          const key = String(mut.key);
          const itemYMap = ymap.get(key) as Y.Map<any> | undefined;
          logger.debug('Yjs state BEFORE update', {
            collection,
            key,
            existsInYjs: !!itemYMap,
            yjsState: itemYMap ? itemYMap.toJSON() : null,
          });
        });

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

        // Log Yjs state AFTER update
        transaction.mutations.forEach((mut: any) => {
          const key = String(mut.key);
          const itemYMap = ymap.get(key) as Y.Map<any> | undefined;
          logger.debug('Yjs state AFTER update', {
            collection,
            key,
            yjsState: itemYMap ? itemYMap.toJSON() : null,
          });
        });

        // Send delta to Convex
        if (pendingUpdate) {
          // Extract document key for clarity and reuse
          const documentKey = String(transaction.mutations[0].key);

          // Retrieve full document from Yjs after applying changes
          // (transaction.mutations[0].modified contains only changed fields, not full doc)
          const itemYMap = ymap.get(documentKey) as Y.Map<any>;
          const fullDoc = itemYMap ? itemYMap.toJSON() : transaction.mutations[0].modified;

          logger.debug('Sending update delta to Convex', {
            collection,
            documentId: documentKey,
            deltaSize: pendingUpdate.length,
            fullDoc,
          });

          const mutationArgs: any = {
            documentId: documentKey,
            crdtBytes: pendingUpdate.slice().buffer, // Create clean copy to avoid byte offset issues
            materializedDoc: fullDoc, // Send full document, not partial changes
            version: Date.now(),
          };

          // Add schema version if metadata is provided
          if (metadata?.schemaVersion !== undefined) {
            mutationArgs._schemaVersion = metadata.schemaVersion;
          }

          await convexClient.mutation(api.updateDocument, mutationArgs);

          pendingUpdate = null;

          // Log complete state after mutation
          const finalYjsState = itemYMap ? itemYMap.toJSON() : null;
          logger.info('Update persisted to Convex', {
            collection,
            documentId: documentKey,
            version: mutationArgs.version,
            sentToConvex: fullDoc,
            yjsStateAfterMutation: finalYjsState,
          });
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
      logger.debug('onDelete handler called', {
        collection,
        mutationCount: transaction.mutations.length,
      });

      try {
        // Wait for BOTH initialization AND IndexedDB persistence
        await Promise.all([initPromise, persistenceReadyPromise]);

        // Remove from Yjs Y.Map - creates deletion tombstone
        ydoc.transact(() => {
          transaction.mutations.forEach((mut: any) => {
            ymap.delete(String(mut.key));
          });
        }, YjsOrigin.Delete);

        // Send deletion DELTA to Convex
        if (pendingUpdate) {
          logger.debug('Sending delete delta to Convex', {
            collection,
            documentId: String(transaction.mutations[0].key),
            deltaSize: pendingUpdate.length,
          });

          const documentKey = String(transaction.mutations[0].key);
          const mutationArgs: any = {
            documentId: documentKey,
            crdtBytes: pendingUpdate.slice().buffer, // Create clean copy to avoid byte offset issues
            version: Date.now(),
          };

          // Add schema version if metadata is provided
          if (metadata?.schemaVersion !== undefined) {
            mutationArgs._schemaVersion = metadata.schemaVersion;
          }

          await convexClient.mutation(api.deleteDocument, mutationArgs);

          pendingUpdate = null;
          logger.info('Delete persisted to Convex', {
            collection,
            documentId: documentKey,
          });
        }
      } catch (error: any) {
        logger.error('Delete failed', {
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
          logger.debug('Cleaning up existing collection before recreation', { collection });
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
          if (isEnhancedSSRFormat(initialData)) {
            // Enhanced format: object with documents + metadata + optional CRDT
            ssrDocuments = initialData.documents;
            ssrCheckpoint = initialData.checkpoint;
            ssrCRDTBytes = initialData.crdtBytes;
          } else {
            // Legacy format: just array of documents
            ssrDocuments = initialData;
          }
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

            logger.info('Initialization complete - IndexedDB loaded', {
              collection,
              yjsDocumentCount: ymap.size,
              hasSSRData: !!ssrDocuments && ssrDocuments.length > 0,
              hasSSRCRDT: !!ssrCRDTBytes,
            });

            // ═══════════════════════════════════════════════════════
            // CRITICAL: If SSR includes CRDT bytes, apply to Yjs FIRST
            // This ensures late-joining clients get correct Item IDs
            // ═══════════════════════════════════════════════════════
            if (ssrCRDTBytes) {
              logger.info('Applying SSR CRDT state to Yjs (preserves Item IDs)', {
                collection,
                crdtSize: ssrCRDTBytes.byteLength,
                cachedCount: ymap.size,
              });

              // Apply CRDT bytes to Yjs (preserves original Item IDs)
              Y.applyUpdateV2(ydoc, new Uint8Array(ssrCRDTBytes), YjsOrigin.SSRInit);

              // Save checkpoint so subscription starts from correct point
              if (ssrCheckpoint) {
                saveCheckpoint(ssrCheckpoint);
                logger.info('SSR CRDT applied - checkpoint saved', {
                  collection,
                  checkpoint: ssrCheckpoint.lastModified,
                  yjsDocumentCount: ymap.size,
                });
              }
            }

            // ═══════════════════════════════════════════════════════
            // STEP 3: Reconcile with main table
            // Remove any documents from Yjs that don't exist in main table
            // This handles deleted documents whose deltas are still in component
            // ═══════════════════════════════════════════════════════
            await reconcileWithMainTable();

            // ═══════════════════════════════════════════════════════
            // STEP 5: TanStack DB is now synced
            // Final merged state from IndexedDB + SSR is now in TanStack DB
            // ═══════════════════════════════════════════════════════

            logger.debug('TanStack DB synced from Yjs', {
              collection,
              yjsCount: ymap.size,
            });

            // ═══════════════════════════════════════════════════════
            // STEP 5: Set up Convex subscription for real-time sync
            // ═══════════════════════════════════════════════════════

            // Set up subscription with checkpoint-based incremental sync
            try {
              logger.debug('Setting up Convex subscription', {
                collection,
                checkpoint:
                  initialItemsForTanStack.length > 0 ? { lastModified: 0 } : loadCheckpoint(),
                limit: 100,
              });

              subscription = convexClient.onUpdate(
                api.stream,
                {
                  checkpoint:
                    initialItemsForTanStack.length > 0 ? { lastModified: 0 } : loadCheckpoint(),
                  limit: 100,
                },
                async (response) => {
                  const { changes, checkpoint: newCheckpoint } = response;

                  logger.debug('Received subscription update', {
                    collection,
                    changeCount: changes.length,
                  });

                  for (const change of changes) {
                    const { operationType, crdtBytes, documentId } = change;

                    switch (operationType) {
                      case 'snapshot': {
                        logger.info('Applying snapshot from server', {
                          collection,
                          snapshotSize: crdtBytes.byteLength,
                        });

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

                      case 'delta':
                      case 'diff':
                      default:
                        logger.debug('Applying delta from server', {
                          collection,
                          documentId,
                          deltaSize: crdtBytes.byteLength,
                        });

                        // Apply delta to Yjs
                        Y.applyUpdateV2(ydoc, new Uint8Array(crdtBytes), YjsOrigin.Subscription);

                        // Sync affected document to TanStack DB if we know which one
                        if (documentId) {
                          const itemYMap = ymap.get(documentId);
                          if (itemYMap instanceof Y.Map) {
                            const { begin, write, commit } = syncParams;
                            const item = itemYMap.toJSON() as T;

                            // Try update first, fall back to insert if item doesn't exist
                            // TanStack DB only supports 'insert', 'update', 'delete' (NO 'upsert')
                            begin();
                            try {
                              write({ type: 'update', value: item });
                              commit();
                              logger.debug('Updated document in TanStack DB', {
                                collection,
                                documentId,
                              });
                            } catch {
                              // Item doesn't exist yet, insert it
                              write({ type: 'insert', value: item });
                              commit();
                              logger.debug('Inserted new document in TanStack DB', {
                                collection,
                                documentId,
                              });
                            }
                          } else {
                            // Document doesn't exist in Yjs (was deleted)
                            // Reconciliation will handle cleanup
                            logger.debug('Document not found in Yjs after delta - likely deleted', {
                              collection,
                              documentId,
                            });
                          }
                        }
                        break;
                    }
                  }

                  // Save checkpoint
                  saveCheckpoint(newCheckpoint);

                  logger.debug('Subscription update processed', {
                    collection,
                    newCheckpoint,
                  });
                }
              );

              logger.info('Convex subscription established', { collection });
            } catch (subscriptionError) {
              logger.error('Failed to setup subscription', {
                collection,
                error: subscriptionError,
              });
              throw subscriptionError;
            }

            // Mark collection as ready
            markReady();
            logger.info('Collection initialized and ready', { collection });
          } catch (error) {
            logger.error('Failed to initialize collection', { error, collection });
            markReady(); // Mark ready anyway to avoid blocking
          }
        })();

        // Return initial data and cleanup function
        return {
          initialData: initialItemsForTanStack,
          cleanup: () => {
            logger.debug('Cleaning up Convex subscription and persistence', { collection });

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

  logger.info('Creating Convex collection with offline reconnect support', { collection });

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

    onLeadershipChange: (isLeader) => {
      logger.info(isLeader ? 'Offline mode active' : 'Online-only mode', {
        collection,
      });
    },

    onStorageFailure: (diagnostic) => {
      logger.warn('Storage failed - online-only mode', {
        collection,
        code: diagnostic.code,
        message: diagnostic.message,
      });
    },
  });

  // Subscribe to Convex connection state for automatic retry trigger
  if (convexClient.connectionState) {
    const connectionState = convexClient.connectionState();
    logger.debug('Initial connection state', {
      collection,
      isConnected: connectionState.isWebSocketConnected,
    });
  }

  // Trigger retry when connection is restored
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      logger.info('Network online - notifying offline executor', { collection });
      offline.notifyOnline();
    });
  }

  logger.info('Offline support initialized', {
    collection,
    mode: offline.mode,
  });

  // Return collection directly - NO WRAPPER!
  // Users call collection.insert/update/delete as normal
  // Handlers run automatically, offline-transactions handles persistence
  return rawCollection as ConvexCollection<T>;
}
