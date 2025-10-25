import type { ConvexClient } from 'convex/browser';
import type { CollectionConfig, SyncConfig } from '@tanstack/db';
import { AutomergeDocumentStore } from './store';
import type { StorageAPI } from './adapter';

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
        const result = await config.convexClient.query(config.api.pullChanges as any, {
          checkpoint,
          limit: 100,
        });

        if (!isInitialSyncComplete && result.changes.length > 0) {
          eventBuffer.push(...result.changes);
        } else {
          begin();
          for (const change of result.changes) {
            store.mergeFromMaterialized(change.documentId, change.document);
            const doc = store.getMaterialized(change.documentId);
            if (doc) {
              write({ type: 'update', value: doc });
            }
          }
          commit();
        }

        checkpoint = result.checkpoint;
      } catch (_error) {
        // Silently fail - will retry on next pull
      }
    };

    const initialSync = async (): Promise<void> => {
      try {
        await store.initialize();

        const initialData = store.toArray();
        if (initialData.length > 0) {
          begin();
          for (const item of initialData) {
            write({ type: 'insert', value: item });
          }
          commit();
        }

        await pullChanges();

        isInitialSyncComplete = true;

        if (eventBuffer.length > 0) {
          begin();
          for (const change of eventBuffer) {
            store.mergeFromMaterialized(change.documentId, change.document);
            const doc = store.getMaterialized(change.documentId);
            if (doc) {
              write({ type: 'update', value: doc });
            }
          }
          commit();
          eventBuffer.splice(0);
        }
      } catch (_error) {
        // Silently fail initial sync - collection will retry on next update
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
