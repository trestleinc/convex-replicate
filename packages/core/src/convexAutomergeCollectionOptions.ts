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
}

export function convexAutomergeCollectionOptions<TItem extends { id: string }>(
  config: ConvexAutomergeCollectionConfig<TItem>
): CollectionConfig<TItem> {
  const store = new AutomergeDocumentStore<TItem>(config.collectionName);
  let checkpoint = { lastModified: 0 };
  const trackedItems = new Set<string>();
  const logger = getConvexReplicateLogger(['collection', config.collectionName]);

  const sync: SyncConfig<TItem, string | number>['sync'] = (params) => {
    const { begin, write, commit, markReady } = params;

    const eventBuffer: Array<{
      documentId: string;
      document: any;
      version: number;
      timestamp: number;
    }> = [];
    let isInitialSyncComplete = false;

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
              store.mergeFromMaterialized(change.documentId, change.document);
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
              } else {
                logger.warn('Document not found after merge', {
                  documentId: change.documentId,
                });
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

        const initialData = store.toArray();
        logger.debug('Loaded local data from IndexedDB', {
          documentCount: initialData.length,
        });

        if (initialData.length > 0) {
          begin();
          for (const item of initialData) {
            write({ type: 'insert', value: item });
            trackedItems.add(String(config.getKey(item)));
          }
          commit();
          logger.debug('Wrote local data to TanStack DB', {
            documentCount: initialData.length,
          });
        }

        await pullChanges();

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
            store.mergeFromMaterialized(change.documentId, change.document);
            const doc = store.getMaterialized(change.documentId);
            if (doc) {
              const key = String(config.getKey(doc));
              const writeType = trackedItems.has(key) ? 'update' : 'insert';
              write({ type: writeType, value: doc });
              trackedItems.add(key);
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

    void initialSync();

    return () => {
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
      }

      const dirty = store.getDirtyMaterialized();

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

      const dirty = store.getDirtyMaterialized();

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
      }

      const dirty = store.getDirtyMaterialized();

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
