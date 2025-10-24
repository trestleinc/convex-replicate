import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import type { AutomergeDocumentStore } from './store';

export interface StorageAPI {
  pullChanges: FunctionReference<'query'>;
  submitBatch: FunctionReference<'mutation'>;
  changeStream: FunctionReference<'query'>;
}

export class SyncAdapter<T extends { id: string }> {
  private pushInterval?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;
  private checkpoint = { lastModified: 0 };

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
      this.api.changeStream,
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
      const result = await this.client.query(this.api.pullChanges, {
        collectionName: this.collectionName,
        checkpoint: this.checkpoint,
        limit: 100,
      });

      for (const change of result.changes) {
        this.store.merge(change.documentId, new Uint8Array(change.data));
      }

      this.checkpoint = result.checkpoint;
    } catch {}
  }

  private async push(): Promise<void> {
    const dirty = this.store.getDirty();
    if (dirty.length === 0) return;

    try {
      await this.client.mutation(this.api.submitBatch, {
        operations: dirty.map(({ id, bytes }) => ({
          collectionName: this.collectionName,
          documentId: id,
          type: 'snapshot' as const,
          data: bytes,
        })),
      });

      for (const { id } of dirty) {
        this.store.clearDirty(id);
      }
    } catch {}
  }
}
