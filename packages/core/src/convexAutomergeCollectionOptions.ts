import type { ConvexClient } from 'convex/browser';
import type { CollectionConfig, SyncConfig } from '@tanstack/db';
import { AutomergeDocumentStore } from './store';
import type { StorageAPI } from './adapter';
import { getConvexReplicateLogger } from './logger';

interface ConvexAutomergeCollectionConfig<TItem extends { id: string }> {
  convexClient: ConvexClient;
  api: StorageAPI;
  collectionName: string;
  getKey: (item: TItem) => string | number;
  id?: string;
  schema?: unknown;
  initialData?: ReadonlyArray<TItem>;
  enableReplicate?: boolean;
}

export function convexAutomergeCollectionOptions<TItem extends { id: string }>(
  config: ConvexAutomergeCollectionConfig<TItem>
): CollectionConfig<TItem> {
  const store = new AutomergeDocumentStore<TItem>(config.collectionName);
  let checkpoint = { lastModified: 0 };
  const logger = getConvexReplicateLogger(['collection', config.collectionName]);

  const sync: SyncConfig<TItem, string | number>['sync'] = (params) => {
    logger.info('Sync function invoked', {
      hasInitialData: !!config.initialData,
      initialDataCount: config.initialData?.length ?? 0,
      enableReplicate: config.enableReplicate ?? true,
    });

    const { begin, write, commit, markReady } = params;

    const eventBuffer: Array<{
      documentId: string;
      crdtBytes: ArrayBuffer;
      version: number;
      timestamp: number;
    }> = [];
    let isInitialSyncComplete = false;

    const shouldEnableReplicate = config.enableReplicate ?? true;
    if (!shouldEnableReplicate) {
      logger.info('Replication disabled, skipping WebSocket setup');
      markReady();
      return () => {};
    }

    const unsubscribeConvex = config.convexClient.onUpdate(
      config.api.changeStream as any,
      { collectionName: config.collectionName },
      () => {
        void pullChanges();
      }
    );

    const unsubscribeAutomerge = store.subscribeToDelta((delta) => {
      if (!isInitialSyncComplete) {
        logger.debug('Skipping Automerge delta during initial sync', {
          insertedCount: delta.inserted.length,
          updatedCount: delta.updated.length,
          deletedCount: delta.deleted.length,
        });
        return;
      }

      logger.debug('Automerge delta received, syncing to TanStack DB', {
        insertedCount: delta.inserted.length,
        updatedCount: delta.updated.length,
        deletedCount: delta.deleted.length,
      });

      begin();

      for (const doc of delta.inserted) {
        logger.debug('Writing insert to TanStack DB', { documentId: doc.id });
        write({ type: 'insert', value: doc });
      }

      for (const doc of delta.updated) {
        logger.debug('Writing update to TanStack DB', { documentId: doc.id });
        write({ type: 'update', value: doc });
      }

      for (const id of delta.deleted) {
        logger.debug('Writing delete to TanStack DB', { documentId: id });
        write({ type: 'delete', value: { id } as TItem });
      }

      commit();

      logger.debug('Synced Automerge delta to TanStack DB', {
        insertedCount: delta.inserted.length,
        updatedCount: delta.updated.length,
        deletedCount: delta.deleted.length,
      });
    });

    const pullChanges = async (): Promise<void> => {
      try {
        logger.debug('Pulling changes from Convex', { checkpoint, isInitialSyncComplete });

        const result = await config.convexClient.query(config.api.pullChanges as any, {
          collectionName: config.collectionName,
          checkpoint,
          limit: 100,
        });

        logger.debug('Received changes from Convex', {
          changeCount: result.changes.length,
          newCheckpoint: result.checkpoint,
          hasMore: result.hasMore,
        });

        if (!isInitialSyncComplete && result.changes.length > 0) {
          logger.debug('Buffering changes during initial sync', {
            bufferSize: result.changes.length,
          });
          eventBuffer.push(...result.changes);
        } else {
          if (result.changes.length > 0) {
            logger.debug('Processing Convex changes', {
              changeCount: result.changes.length,
            });

            begin();
            for (const change of result.changes) {
              // Convert ArrayBuffer to Uint8Array and merge CRDT bytes
              store.mergeCRDT(change.documentId, new Uint8Array(change.crdtBytes));

              // Get materialized document after merging
              const doc = store.getMaterialized(change.documentId);

              if (!doc) {
                // Document was deleted or doesn't exist
                logger.debug('Writing delete to TanStack DB', {
                  documentId: change.documentId,
                });
                write({ type: 'delete', value: { id: change.documentId } as TItem });
              } else {
                logger.debug('Writing update to TanStack DB', {
                  documentId: change.documentId,
                });
                write({ type: 'update', value: doc });
              }
            }
            commit();

            logger.debug('Applied Convex changes to TanStack DB', {
              changeCount: result.changes.length,
            });
          }
        }

        checkpoint = result.checkpoint;
      } catch (error) {
        logger.error('Failed to pull changes from Convex', {
          checkpoint,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    };

    const initialSync = async (): Promise<void> => {
      try {
        logger.info('Starting initial sync', { collection: config.collectionName });

        await store.initialize();

        const localData = store.toArray();
        logger.debug('Loaded local data from IndexedDB', {
          documentCount: localData.length,
        });

        if (config.initialData && config.initialData.length > 0) {
          logger.debug('Merging SSR initial data with local CRDTs', {
            initialDataCount: config.initialData.length,
            localDataCount: localData.length,
          });

          for (const serverItem of config.initialData) {
            const id = String(config.getKey(serverItem));
            store.mergeFromMaterialized(id, serverItem);
          }
        }

        await pullChanges();

        const finalData = store.toArray();
        logger.debug('Final merged data ready', {
          documentCount: finalData.length,
        });

        if (finalData.length > 0) {
          begin();
          for (const item of finalData) {
            write({ type: 'insert', value: item });
          }
          commit();
          logger.debug('Wrote final merged data to TanStack DB', {
            documentCount: finalData.length,
          });
        }

        isInitialSyncComplete = true;
        logger.info('Initial sync complete, enabling Automerge subscriber', {
          bufferedEventCount: eventBuffer.length,
        });

        if (eventBuffer.length > 0) {
          logger.debug('Processing buffered Convex events', {
            eventCount: eventBuffer.length,
          });

          begin();
          for (const change of eventBuffer) {
            // Convert ArrayBuffer to Uint8Array and merge CRDT bytes
            store.mergeCRDT(change.documentId, new Uint8Array(change.crdtBytes));

            // Get materialized document after merging
            const doc = store.getMaterialized(change.documentId);

            if (!doc) {
              // Document was deleted or doesn't exist
              write({ type: 'delete', value: { id: change.documentId } as TItem });
            } else {
              write({ type: 'update', value: doc });
            }
          }
          commit();

          eventBuffer.splice(0);
          logger.debug('Applied buffered events to TanStack DB');
        }
      } catch (error) {
        logger.error('Failed during initial sync', {
          collection: config.collectionName,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      } finally {
        markReady();
      }
    };

    logger.debug('Starting initial sync in background');
    void initialSync();

    logger.debug('Sync function setup complete, returning cleanup function');
    return () => {
      logger.debug('Cleanup function called, unsubscribing from Convex and Automerge');
      unsubscribeConvex();
      unsubscribeAutomerge();
    };
  };

  return {
    id: config.id ?? config.collectionName,
    getKey: config.getKey,
    sync: { sync },

    onInsert: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        const item = mutation.modified;

        const id = String(config.getKey(item));
        const { id: _id, ...data } = item;
        store.create(id, data as Omit<TItem, 'id'>);
      }

      const unreplicated = store.getUnreplicatedCRDTBytes();

      if (unreplicated.length > 0) {
        await Promise.all(
          unreplicated.map(({ id, crdtBytes, materializedDoc, version }) =>
            config.convexClient.mutation(config.api.insertDocument as any, {
              collectionName: config.collectionName,
              documentId: id,
              crdtBytes: crdtBytes.buffer,
              materializedDoc,
              version,
            })
          )
        );

        for (const { id } of unreplicated) {
          store.markReplicated(id);
        }
      }

      return transaction.mutations.map((m) => config.getKey(m.modified));
    },

    onUpdate: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        const id = String(mutation.key);
        const changes = mutation.changes;

        store.change(id, (draft) => {
          Object.assign(draft, changes);
        });
      }

      const unreplicated = store.getUnreplicatedCRDTBytes();

      if (unreplicated.length > 0) {
        await Promise.all(
          unreplicated.map(({ id, crdtBytes, materializedDoc, version }) =>
            config.convexClient.mutation(config.api.updateDocument as any, {
              collectionName: config.collectionName,
              documentId: id,
              crdtBytes: crdtBytes.buffer,
              materializedDoc,
              version,
            })
          )
        );

        for (const { id } of unreplicated) {
          store.markReplicated(id);
        }
      }
    },

    onDelete: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        const id = String(mutation.key);
        store.remove(id);
      }

      // Deletes are handled differently - just mark as deleted in CRDT
      // The remove() call above marks the doc as deleted in Automerge
      const unreplicated = store.getUnreplicatedCRDTBytes();

      if (unreplicated.length > 0) {
        await Promise.all(
          unreplicated.map(({ id, crdtBytes, materializedDoc, version }) =>
            config.convexClient.mutation(config.api.updateDocument as any, {
              collectionName: config.collectionName,
              documentId: id,
              crdtBytes: crdtBytes.buffer,
              materializedDoc,
              version,
            })
          )
        );

        for (const { id } of unreplicated) {
          store.markReplicated(id);
        }
      }
    },
  };
}
