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
  const trackedItems = new Set<string>();
  const seenIds = new Set<string>();
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
      document: any;
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

    const unsubscribe = config.convexClient.onUpdate(config.api.changeStream as any, {}, () => {
      void pullChanges();
    });

    const pullChanges = async (): Promise<void> => {
      try {
        logger.debug('Pulling changes from Convex', { checkpoint, isInitialSyncComplete });

        const result = await config.convexClient.query(config.api.pullChanges as any, {
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
            begin();
            for (const change of result.changes) {
              if (seenIds.has(change.documentId)) {
                logger.debug('Skipping already seen document', {
                  documentId: change.documentId,
                });
                continue;
              }

              store.mergeFromMaterialized(change.documentId, change.document);

              if (change.document.deleted) {
                const key = config.getKey({ id: change.documentId } as TItem);
                if (trackedItems.has(String(key))) {
                  logger.debug('Writing deletion to TanStack DB', {
                    documentId: change.documentId,
                    key,
                  });
                  write({ type: 'delete', value: { id: change.documentId } as TItem });
                  trackedItems.delete(String(key));
                  seenIds.delete(change.documentId);
                }
              } else {
                const doc = store.getMaterialized(change.documentId);
                if (doc) {
                  const key = String(config.getKey(doc));
                  const writeType = trackedItems.has(key) ? 'update' : 'insert';
                  logger.debug('Writing change to TanStack DB', {
                    documentId: change.documentId,
                    writeType,
                    tracked: trackedItems.has(key),
                  });
                  write({ type: writeType, value: doc });
                  trackedItems.add(key);
                  seenIds.add(change.documentId);
                } else {
                  logger.warn('Document not found after merge', {
                    documentId: change.documentId,
                  });
                }
              }
            }
            commit();
            logger.debug('Committed changes to TanStack DB', {
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
            const key = String(config.getKey(item));
            write({ type: 'insert', value: item });
            trackedItems.add(key);
            seenIds.add(item.id);
          }
          commit();
          logger.debug('Wrote final merged data to TanStack DB (SINGLE WRITE)', {
            documentCount: finalData.length,
          });
        }

        isInitialSyncComplete = true;
        logger.info('Initial sync complete', {
          bufferedEventCount: eventBuffer.length,
        });

        if (eventBuffer.length > 0) {
          logger.debug('Processing buffered events', {
            eventCount: eventBuffer.length,
          });
          begin();
          for (const change of eventBuffer) {
            if (seenIds.has(change.documentId)) {
              logger.debug('Skipping already seen buffered document', {
                documentId: change.documentId,
              });
              continue;
            }

            store.mergeFromMaterialized(change.documentId, change.document);

            if (change.document.deleted) {
              const key = config.getKey({ id: change.documentId } as TItem);
              if (trackedItems.has(String(key))) {
                write({ type: 'delete', value: { id: change.documentId } as TItem });
                trackedItems.delete(String(key));
                seenIds.delete(change.documentId);
              }
            } else {
              const doc = store.getMaterialized(change.documentId);
              if (doc) {
                const key = String(config.getKey(doc));
                const writeType = trackedItems.has(key) ? 'update' : 'insert';
                write({ type: writeType, value: doc });
                trackedItems.add(key);
                seenIds.add(change.documentId);
              }
            }
          }
          commit();
          eventBuffer.splice(0);
          logger.debug('Processed buffered events');
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
      logger.debug('Cleanup function called, unsubscribing');
      unsubscribe();
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
        trackedItems.add(id);
        seenIds.add(id);
      }

      const dirty = store.getDirtyForSync();

      if (dirty.length > 0) {
        await Promise.all(
          dirty.map(({ id, document, version }) =>
            config.convexClient.mutation(config.api.submitDocument as any, {
              id,
              document,
              version,
            })
          )
        );

        for (const { id } of dirty) {
          store.clearDirty(id);
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

      const dirty = store.getDirtyForSync();

      if (dirty.length > 0) {
        await Promise.all(
          dirty.map(({ id, document, version }) =>
            config.convexClient.mutation(config.api.submitDocument as any, {
              id,
              document,
              version,
            })
          )
        );

        for (const { id } of dirty) {
          store.clearDirty(id);
        }
      }
    },

    onDelete: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        const id = String(mutation.key);
        store.remove(id);
        seenIds.delete(id);
      }

      const dirty = store.getDirtyForSync();

      if (dirty.length > 0) {
        await Promise.all(
          dirty.map(({ id, document, version }) =>
            config.convexClient.mutation(config.api.submitDocument as any, {
              id,
              document,
              version,
            })
          )
        );

        for (const { id } of dirty) {
          store.clearDirty(id);
        }
      }
    },
  };
}
