import { useMemo } from 'react';
import { createCollection } from '@tanstack/react-db';
import type { Collection } from '@tanstack/db';
import { convexAutomergeCollectionOptions, type StorageAPI } from '@convex-rx/core';
import { useConvexClient } from './provider';

export interface UseConvexReplicateConfig {
  collectionName: string;
  api: StorageAPI;
}

export function useConvexReplicate<T extends { id: string }>(
  config: UseConvexReplicateConfig
): Collection<T> {
  const client = useConvexClient();

  const collection = useMemo(
    () =>
      createCollection(
        convexAutomergeCollectionOptions<T>({
          convexClient: client as any,
          api: config.api,
          collectionName: config.collectionName,
          getKey: (item: T) => item.id,
        })
      ),
    [client, config.api, config.collectionName]
  );

  return collection;
}
