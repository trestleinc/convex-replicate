import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  AutomergeDocumentStore,
  SyncAdapter,
  configureLogger,
  type StorageAPI,
} from '@convex-rx/core';
import { useConvexClient } from './provider';
import { AutomergeCollection } from './collection';

export interface UseConvexReplicateConfig {
  collectionName: string;
  api: StorageAPI;
  enableLogging?: boolean;
}

export function useConvexReplicate<T extends { id: string }>(
  config: UseConvexReplicateConfig
): AutomergeCollection<T> {
  const client = useConvexClient();

  const collection = useMemo(() => {
    const store = new AutomergeDocumentStore<T>(config.collectionName);
    const col = new AutomergeCollection(store);

    void configureLogger(config.enableLogging);
    void col.initialize();

    return col;
  }, [config.collectionName, config.enableLogging]);

  const adapter = useMemo(
    () => new SyncAdapter(collection.store, client as never, config.api, config.collectionName),
    [collection.store, client, config.api, config.collectionName]
  );

  useEffect(() => {
    void adapter.start();
    return () => {
      adapter.stop();
      collection.cleanup();
    };
  }, [adapter, collection]);

  useSyncExternalStore(
    (callback) => collection.subscribe(callback),
    () => collection.toArray,
    () => []
  );

  return collection;
}
