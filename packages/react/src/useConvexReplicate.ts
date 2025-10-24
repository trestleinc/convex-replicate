import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AutomergeDocumentStore, SyncAdapter, type StorageAPI } from '@convex-rx/core';
import { useConvexClient } from './provider';

export interface UseConvexReplicateConfig<T extends { id: string }> {
  collectionName: string;
  api: StorageAPI;
  initialData?: T[];
}

export function useConvexReplicate<T extends { id: string }>(config: UseConvexReplicateConfig<T>) {
  const client = useConvexClient();

  const store = useMemo(
    () => new AutomergeDocumentStore<T>(config.collectionName),
    [config.collectionName]
  );

  const adapter = useMemo(
    () => new SyncAdapter(store, client, config.api, config.collectionName),
    [store, client, config.api, config.collectionName]
  );

  useEffect(() => {
    void adapter.start();
    return () => adapter.stop();
  }, [adapter]);

  const data = useSyncExternalStore(
    (callback) => store.subscribe(callback),
    () => store.toArray(),
    () => config.initialData || []
  );

  const actions = useMemo(
    () => ({
      create: (id: string, data: Omit<T, 'id'>) => {
        store.create(id, data);
      },
      update: (id: string, updateFn: (draft: T) => void) => {
        store.change(id, updateFn);
      },
      remove: (id: string) => {
        store.remove(id);
      },
    }),
    [store]
  );

  return { data, actions };
}
