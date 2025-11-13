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
 * Configuration for convexCollectionOptions (Step 1)
 * All params go here - they'll be used to create the collection config
 */
export interface ConvexCollectionOptionsConfig<T extends object> {
  /** Function to extract unique key from items */
  getKey: (item: T) => string | number;

  /** Optional initial data to populate collection */
  initialData?: ReadonlyArray<T>;

  /** Convex client instance */
  convexClient: ConvexClient;

  /** Convex API functions for this collection */
  api: {
    stream: FunctionReference<'query'>; // For streaming data from main table (required)
    insertDocument: FunctionReference<'mutation'>; // Insert handler (required)
    updateDocument: FunctionReference<'mutation'>; // Update handler (required)
    deleteDocument: FunctionReference<'mutation'>; // Delete handler (required)
    getProtocolVersion?: FunctionReference<'query'>; // Protocol version check (optional)
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

  // Initialize Yjs document with persistent IndexedDB storage
  const ydoc = new Y.Doc({ guid: collection });
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
              // Create new Y.Map if doesn't exist (defensive)
              const modifiedFields = mut.modified as Record<string, unknown>;
              if (!modifiedFields) {
                logger.warn('mut.modified is null/undefined for new item', {
                  collection,
                  key: String(mut.key),
                });
                return;
              }
              const newYMap = new Y.Map();
              Object.entries(modifiedFields).forEach(([k, v]) => {
                newYMap.set(k, v);
              });
              ymap.set(String(mut.key), newYMap);
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
      sync: (params: any) => {
        const { markReady } = params;

        // Store TanStack DB sync methods for snapshot restore
        syncParams = params;

        // Initialize subscription variable
        let subscription: (() => void) | null = null;

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
              hasSSRData: !!initialData && initialData.length > 0,
            });

            // ═══════════════════════════════════════════════════════
            // STEP 2: Merge SSR data into Yjs using CRDT semantics
            // IndexedDB loaded first, now merge fresh SSR data
            // ═══════════════════════════════════════════════════════
            if (initialData && initialData.length > 0) {
              logger.info('Merging SSR data into Yjs after IndexedDB', {
                collection,
                ssrCount: initialData.length,
                cachedCount: ymap.size,
              });

              ydoc.transact(() => {
                for (const item of initialData) {
                  const key = String(getKey(item));

                  // Get existing Y.Map or create new one
                  let itemYMap = ymap.get(key) as Y.Map<any> | undefined;
                  if (!itemYMap) {
                    itemYMap = new Y.Map();
                    ymap.set(key, itemYMap);
                  }

                  // CRDT merge: Update all fields from SSR data
                  // Yjs automatically handles conflicts based on last-write-wins semantics
                  Object.entries(item).forEach(([k, v]) => {
                    itemYMap.set(k, v);
                  });
                }
              }, YjsOrigin.SSRInit);

              logger.info('SSR data merged into Yjs', {
                collection,
                finalCount: ymap.size,
              });
            }

            // ═══════════════════════════════════════════════════════
            // STEP 3: Sync Yjs state to TanStack DB
            // After IndexedDB + SSR merge, sync final state to TanStack DB
            // ═══════════════════════════════════════════════════════
            if (ymap.size > 0) {
              logger.info('Triggering observer to sync Yjs to TanStack DB', {
                collection,
                yjsCount: ymap.size,
              });

              // Manually sync all Yjs data to TanStack DB
              // Direct write since Yjs already contains the SSR state
              const { begin, write, commit } = syncParams;
              begin();

              ymap.forEach((itemYMap, _key) => {
                if (itemYMap instanceof Y.Map) {
                  const item = itemYMap.toJSON() as T;
                  write({ type: 'update', value: item });
                }
              });

              commit();

              logger.info('Yjs state synced to TanStack DB', {
                collection,
                count: ymap.size,
              });
            } else {
              logger.debug('No data in Yjs - starting fresh', {
                collection,
              });
            }

            // ═══════════════════════════════════════════════════════
            // STEP 4: TanStack DB is now synced
            // Final merged state from IndexedDB + SSR is now in TanStack DB
            // ═══════════════════════════════════════════════════════

            logger.debug('TanStack DB synced from Yjs', {
              collection,
              yjsCount: ymap.size,
            });

            // ═══════════════════════════════════════════════════════
            // STEP 5: Set up Convex subscription for real-time sync
            // State vector ensures server only sends diffs we don't have
            // ═══════════════════════════════════════════════════════

            // Load persisted checkpoint
            const checkpoint = loadCheckpoint();

            logger.debug('Starting Convex subscription', {
              collection,
              checkpoint,
            });

            // Encode client's state vector for gap-free sync
            // This tells server exactly what we know, enabling minimal diff computation
            const vector = Y.encodeStateVector(ydoc);

            subscription = convexClient.onUpdate(
              api.stream,
              {
                checkpoint,
                vector: vector.buffer,
                limit: 100,
              },
              async (response) => {
                // Destructure structured response from stream query
                const { changes, checkpoint: newCheckpoint } = response;

                try {
                  logger.debug('Subscription update received', {
                    collection,
                    changeCount: changes.length,
                  });

                  // Apply CRDT changes to Yjs (Yjs handles conflict resolution)
                  for (const change of changes) {
                    switch (change.operationType) {
                      case 'snapshot': {
                        // Full snapshot received - rebuild Y.Doc from snapshot
                        logger.info('Received snapshot - rebuilding collection', {
                          collection,
                          snapshotSize: change.crdtBytes.byteLength,
                          timestamp: change.timestamp,
                        });

                        // Decode and restore snapshot
                        const snapshotDecoded = Y.decodeSnapshotV2(
                          new Uint8Array(change.crdtBytes)
                        );
                        const restoredDoc = Y.createDocFromSnapshot(ydoc, snapshotDecoded);

                        // Clear existing Y.Doc content and copy snapshot data
                        ydoc.transact(() => {
                          ymap.clear();
                          const restoredMap = restoredDoc.getMap(collection);
                          restoredMap.forEach((value, key) => {
                            ymap.set(key, value);
                          });
                        }, YjsOrigin.Snapshot);

                        restoredDoc.destroy();

                        // CRITICAL FIX: Directly sync all items to TanStack DB
                        // Snapshot restore uses YjsOrigin.Snapshot, but we need explicit sync
                        if (syncParams) {
                          const { begin, write, commit } = syncParams;
                          try {
                            begin();
                            ymap.forEach((itemYMap, _key) => {
                              if (itemYMap instanceof Y.Map) {
                                const item = itemYMap.toJSON() as T;
                                write({ type: 'update', value: item });
                              }
                            });
                            commit();

                            logger.debug('Synced snapshot to TanStack DB', {
                              collection,
                              itemCount: ymap.size,
                            });
                          } catch (error) {
                            logger.error('Failed to sync snapshot to TanStack DB', {
                              collection,
                              error,
                            });
                          }
                        }

                        logger.info('Snapshot restored', {
                          collection,
                          documentCount: ymap.size,
                        });
                        break;
                      }

                      case 'diff':
                      case 'delta': {
                        // Log Yjs state BEFORE applying subscription delta
                        const yjsStateBefore = change.documentId
                          ? (ymap.get(change.documentId) as Y.Map<any>)?.toJSON()
                          : null;

                        logger.info('Applying subscription delta', {
                          collection,
                          documentId: change.documentId,
                          operationType: change.operationType,
                          version: change.version,
                          deltaSize: change.crdtBytes.byteLength,
                          yjsStateBefore,
                        });

                        // Both diffs and deltas use UpdateV2 format
                        // Apply as normal CRDT update - Yjs automatically merges
                        Y.applyUpdateV2(
                          ydoc,
                          new Uint8Array(change.crdtBytes),
                          YjsOrigin.Subscription
                        );

                        // Log Yjs state AFTER applying subscription delta
                        const yjsStateAfter = change.documentId
                          ? (ymap.get(change.documentId) as Y.Map<any>)?.toJSON()
                          : null;

                        logger.info('Applied subscription delta', {
                          collection,
                          documentId: change.documentId,
                          operationType: change.operationType,
                          version: change.version,
                          yjsStateAfter,
                        });

                        // CRITICAL FIX: Sync ALL Yjs documents to TanStack DB
                        // After applying delta, Yjs state is updated but we need to ensure
                        // TanStack DB reflects the complete Yjs state, not just the changed document
                        // This handles cases where delta creates new documents or merges with existing ones
                        if (syncParams) {
                          const { begin, write, commit } = syncParams;
                          try {
                            begin();

                            // Sync all documents from Yjs to TanStack DB
                            ymap.forEach((itemYMap, _key) => {
                              if (itemYMap instanceof Y.Map) {
                                const item = itemYMap.toJSON() as T;
                                write({ type: 'update', value: item });
                              }
                            });

                            commit();

                            logger.debug(
                              'Synced all Yjs state to TanStack DB after subscription delta',
                              {
                                collection,
                                yjsMapSize: ymap.size,
                                triggeringDocId: change.documentId,
                              }
                            );
                          } catch (error) {
                            logger.error(
                              'Failed to sync Yjs state to TanStack DB after subscription delta',
                              {
                                collection,
                                error,
                              }
                            );
                          }
                        }
                        break;
                      }

                      default: {
                        logger.warn('Unknown operationType - skipping', {
                          collection,
                          operationType: change.operationType,
                        });
                      }
                    }
                  }

                  // Save new checkpoint for next sync
                  saveCheckpoint(newCheckpoint);

                  logger.debug('Successfully processed changes', {
                    collection,
                    count: changes.length,
                    newCheckpoint,
                  });
                } catch (error: any) {
                  logger.error('Failed to apply CRDT deltas from subscription', {
                    error: error.message,
                    errorName: error.name,
                    stack: error?.stack,
                    collection,
                    changeCount: changes.length,
                  });
                  throw error; // Re-throw to prevent silent failures
                }
              }
            );

            markReady();
          } catch (error) {
            logger.error('Failed to initialize or setup subscription', { error, collection });
            // Mark ready anyway to avoid blocking the collection
            markReady();
          }
        })();

        // Return cleanup function (subscription might not be ready yet)
        return () => {
          logger.debug('Cleaning up Convex subscription and persistence', { collection });

          // Cleanup subscription
          if (subscription) {
            subscription();
          }

          // Cleanup IndexedDB persistence connection
          persistence.destroy();
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
