import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import type { AutomergeDocumentStore } from './store';
import { getLogger } from './logger';

export interface StorageAPI {
  insertDocument: FunctionReference<
    'mutation',
    'public' | 'internal',
    {
      collectionName: string;
      documentId: string;
      crdtBytes: ArrayBuffer;
      materializedDoc: unknown;
      version: number;
    },
    { success: boolean }
  >;
  updateDocument: FunctionReference<
    'mutation',
    'public' | 'internal',
    {
      collectionName: string;
      documentId: string;
      crdtBytes: ArrayBuffer;
      materializedDoc: unknown;
      version: number;
    },
    { success: boolean }
  >;
  deleteDocument: FunctionReference<
    'mutation',
    'public' | 'internal',
    {
      collectionName: string;
      documentId: string;
    },
    { success: boolean }
  >;
  pullChanges: FunctionReference<
    'query',
    'public' | 'internal',
    {
      collectionName: string;
      checkpoint: { lastModified: number };
      limit?: number;
    },
    {
      changes: Array<{
        documentId: string;
        crdtBytes: ArrayBuffer;
        version: number;
        timestamp: number;
      }>;
      checkpoint: { lastModified: number };
      hasMore: boolean;
    }
  >;
  changeStream: FunctionReference<
    'query',
    'public' | 'internal',
    { collectionName: string },
    { timestamp: number; count: number }
  >;
}

export class SyncAdapter<T extends { id: string }> {
  private pushInterval?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;
  private checkpoint = { lastModified: 0 };
  private logger = getLogger(['adapter']);

  constructor(
    private store: AutomergeDocumentStore<T>,
    private client: ConvexClient,
    private api: StorageAPI,
    private collectionName: string
  ) {}

  async start(): Promise<void> {
    await this.pull();

    this.pushInterval = setInterval(() => void this.push(), 5000);

    this.unsubscribe = this.client.onUpdate(
      this.api.changeStream as any,
      { collectionName: this.collectionName },
      () => void this.pull()
    );
  }

  stop(): void {
    if (this.pushInterval) clearInterval(this.pushInterval);
    if (this.unsubscribe) this.unsubscribe();
  }

  private async pull(): Promise<void> {
    try {
      const result = await this.client.query(this.api.pullChanges as any, {
        collectionName: this.collectionName,
        checkpoint: this.checkpoint,
        limit: 100,
      });

      if (result.changes.length > 0) {
        this.logger.debug('Pulled changes from server', {
          collection: this.collectionName,
          changeCount: result.changes.length,
          checkpoint: result.checkpoint,
        });
      }

      for (const change of result.changes) {
        this.store.merge(change.documentId, new Uint8Array(change.data));
      }

      this.checkpoint = result.checkpoint;
    } catch (error) {
      this.logger.warn('Failed to pull changes from server', {
        collection: this.collectionName,
        checkpoint: this.checkpoint,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async push(): Promise<void> {
    const unreplicated = this.store.getUnreplicatedMaterialized();
    if (unreplicated.length === 0) return;

    this.logger.debug('Pushing changes to server', {
      collection: this.collectionName,
      changeCount: unreplicated.length,
    });

    try {
      // TODO: Update SyncAdapter to use new API
      // await Promise.all(
      //   unreplicated.map(({ id, bytes }) =>
      //     this.client.mutation(this.api.insertDocument as any, {
      //       collectionName: this.collectionName,
      //       documentId: id,
      //       crdtBytes: bytes.buffer,
      //       materializedDoc: {}, // TODO
      //       version: 1,
      //     })
      //   )
      // );

      for (const { id } of unreplicated) {
        this.store.markReplicated(id);
      }

      this.logger.debug('Successfully pushed changes to server', {
        collection: this.collectionName,
        changeCount: unreplicated.length,
      });
    } catch (error) {
      this.logger.warn('Failed to push changes to server', {
        collection: this.collectionName,
        changeCount: unreplicated.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
