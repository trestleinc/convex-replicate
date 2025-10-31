import * as Automerge from '@automerge/automerge';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { getConvexReplicateLogger } from './logger';

type DeletableDocument = { deleted?: boolean };

export interface StoreDelta<T> {
  inserted: T[];
  updated: T[];
  deleted: string[];
}

export type DeltaListener<T> = (delta: StoreDelta<T>) => void;

export class AutomergeDocumentStore<T extends { id: string }> {
  private docs = new Map<string, Automerge.Doc<T>>();
  private unreplicatedDocs = new Set<string>();
  private previousSnapshot = new Map<string, T>();
  private deltaListeners = new Set<DeltaListener<T>>();
  private listeners = new Set<(docs: T[]) => void>();
  private isInitialized = false;
  private storage: IndexedDBStorageAdapter | null = null;
  private logger = getConvexReplicateLogger(['store']);

  constructor(private readonly collectionName: string) {
    if (typeof indexedDB !== 'undefined') {
      this.storage = new IndexedDBStorageAdapter(`convex-replicate-${collectionName}`);
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (this.storage) {
      try {
        const chunks = await this.storage.loadRange([]);

        this.logger.debug('Loading persisted documents from IndexedDB', {
          collection: this.collectionName,
          chunkCount: chunks.length,
        });

        for (const chunk of chunks) {
          const [id] = chunk.key;
          if (!id || !chunk.data) continue;

          try {
            const doc = Automerge.load<T>(chunk.data);
            this.docs.set(id, doc);
          } catch (error) {
            this.logger.warn('Failed to load document from IndexedDB', {
              collection: this.collectionName,
              documentId: id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        this.logger.info('Initialized document store from IndexedDB', {
          collection: this.collectionName,
          documentCount: this.docs.size,
        });
      } catch (error) {
        this.logger.warn('IndexedDB storage unavailable, continuing without persistence', {
          collection: this.collectionName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      this.logger.debug('IndexedDB not available (SSR), skipping persistence', {
        collection: this.collectionName,
      });
    }

    this.isInitialized = true;
    this.notify();
  }

  private async persistToIndexedDB(id: string, bytes: Uint8Array): Promise<void> {
    if (!this.storage) return;

    try {
      await this.storage.save([id], bytes);
    } catch (error) {
      this.logger.warn('Failed to persist document to IndexedDB', {
        collection: this.collectionName,
        documentId: id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  create(id: string, data: Omit<T, 'id'>): Uint8Array {
    const doc = Automerge.from({
      ...data,
      id,
      deleted: false,
    } as T & DeletableDocument);
    this.docs.set(id, doc);
    this.unreplicatedDocs.add(id);
    const bytes = Automerge.save(doc);
    void this.persistToIndexedDB(id, bytes);
    this.notify();
    return bytes;
  }

  change(id: string, updateFn: (draft: T) => void): Uint8Array | null {
    const doc = this.docs.get(id);
    if (!doc) return null;

    const newDoc = Automerge.change(doc, updateFn);
    this.docs.set(id, newDoc);
    this.unreplicatedDocs.add(id);
    const bytes = Automerge.save(newDoc);
    void this.persistToIndexedDB(id, bytes);
    this.notify();

    return bytes;
  }

  remove(id: string): Uint8Array | null {
    return this.change(id, (draft) => {
      (draft as T & DeletableDocument).deleted = true;
    });
  }

  merge(id: string, bytes: Uint8Array): void {
    const existing = this.docs.get(id);
    const incoming = Automerge.load<T>(bytes);

    const merged = existing ? Automerge.merge(existing, incoming) : incoming;

    this.docs.set(id, merged);
    const mergedBytes = Automerge.save(merged);
    void this.persistToIndexedDB(id, mergedBytes);
    this.notify(true);
  }

  getUnreplicated(): Array<{ id: string; bytes: Uint8Array }> {
    return Array.from(this.unreplicatedDocs)
      .map((id) => {
        const doc = this.docs.get(id);
        return doc ? { id, bytes: Automerge.save(doc) } : null;
      })
      .filter((item): item is { id: string; bytes: Uint8Array } => item !== null);
  }

  getUnreplicatedCRDTBytes(): Array<{
    id: string;
    crdtBytes: Uint8Array;
    materializedDoc: T;
    version: number;
  }> {
    return Array.from(this.unreplicatedDocs)
      .map((id) => {
        const doc = this.docs.get(id);
        if (!doc) return null;

        const materialized = { ...doc } as T;
        const deletable = materialized as T & DeletableDocument;
        if (deletable.deleted) return null;

        return {
          id,
          crdtBytes: Automerge.save(doc),
          materializedDoc: materialized,
          version: Automerge.getHeads(doc).length,
        };
      })
      .filter(
        (
          item
        ): item is { id: string; crdtBytes: Uint8Array; materializedDoc: T; version: number } =>
          item !== null
      );
  }

  markReplicated(id: string): void {
    this.unreplicatedDocs.delete(id);
  }

  getDoc(id: string): Automerge.Doc<T> | undefined {
    return this.docs.get(id);
  }

  setDoc(id: string, doc: Automerge.Doc<T>): void {
    this.docs.set(id, doc);
    const bytes = Automerge.save(doc);
    void this.persistToIndexedDB(id, bytes);
    this.notify();
  }

  mergeCRDT(id: string, crdtBytes: Uint8Array): void {
    this.merge(id, crdtBytes);
  }

  getMaterialized(id: string): T | undefined {
    const doc = this.docs.get(id);
    if (!doc) return undefined;

    const materialized = { ...doc };
    const deletable = materialized as T & DeletableDocument;
    if (deletable.deleted) return undefined;

    return materialized;
  }

  getUnreplicatedMaterialized(): Array<{ id: string; document: T; version: number }> {
    return Array.from(this.unreplicatedDocs)
      .map((id) => {
        const doc = this.docs.get(id);
        if (!doc) return null;

        const materialized = { ...doc };
        const deletable = materialized as T & DeletableDocument;
        if (deletable.deleted) return null;

        return {
          id,
          document: materialized,
          version: Automerge.getHeads(doc).length,
        };
      })
      .filter((item): item is { id: string; document: T; version: number } => item !== null);
  }

  getUnreplicatedForConvex(): Array<{
    id: string;
    document: T & DeletableDocument;
    version: number;
  }> {
    return Array.from(this.unreplicatedDocs)
      .map((id) => {
        const doc = this.docs.get(id);
        if (!doc) return null;

        return {
          id,
          document: { ...doc } as T & DeletableDocument,
          version: Automerge.getHeads(doc).length,
        };
      })
      .filter(
        (item): item is { id: string; document: T & DeletableDocument; version: number } =>
          item !== null
      );
  }

  mergeFromMaterialized(id: string, remoteDoc: Partial<T>): void {
    let doc = this.docs.get(id);

    const cleanRemoteDoc = Object.fromEntries(
      Object.entries(remoteDoc).filter(([_, value]) => value !== undefined && value !== null)
    );

    if ('deleted' in cleanRemoteDoc && cleanRemoteDoc.deleted === undefined) {
      delete cleanRemoteDoc.deleted;
    }

    if (!('deleted' in cleanRemoteDoc)) {
      (cleanRemoteDoc as any).deleted = false;
    }

    if (!doc) {
      doc = Automerge.from(cleanRemoteDoc as T);
      this.docs.set(id, doc);
    } else {
      doc = Automerge.change(doc, (draft) => {
        Object.assign(draft, cleanRemoteDoc);
      });
      this.docs.set(id, doc);
    }

    const bytes = Automerge.save(doc);
    void this.persistToIndexedDB(id, bytes);
    this.notify(true);
  }

  toArray(): T[] {
    return Array.from(this.docs.values())
      .map((doc) => ({ ...doc }))
      .filter((doc) => {
        const deletable = doc as T & DeletableDocument;
        return !deletable.deleted;
      });
  }

  subscribeToDelta(fn: DeltaListener<T>): () => void {
    this.deltaListeners.add(fn);
    return () => this.deltaListeners.delete(fn);
  }

  subscribe(fn: (docs: T[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(silent = false): void {
    if (silent) {
      this.updatePreviousSnapshot();
      return;
    }

    const currentDocs = this.toArray();
    const currentMap = new Map(currentDocs.map((d) => [d.id, d]));

    const delta = this.calculateDelta(currentMap);

    for (const fn of this.deltaListeners) {
      fn(delta);
    }

    for (const fn of this.listeners) {
      fn(currentDocs);
    }

    this.updatePreviousSnapshot();
  }

  private calculateDelta(currentMap: Map<string, T>): StoreDelta<T> {
    const inserted: T[] = [];
    const updated: T[] = [];
    const deleted: string[] = [];

    for (const [id, currentDoc] of currentMap) {
      const previousDoc = this.previousSnapshot.get(id);

      if (!previousDoc) {
        inserted.push(currentDoc);
      } else if (!this.areDocsEqual(previousDoc, currentDoc)) {
        updated.push(currentDoc);
      }
    }

    for (const id of this.previousSnapshot.keys()) {
      if (!currentMap.has(id)) {
        deleted.push(id);
      }
    }

    return { inserted, updated, deleted };
  }

  private areDocsEqual(doc1: T, doc2: T): boolean {
    return JSON.stringify(doc1) === JSON.stringify(doc2);
  }

  private updatePreviousSnapshot(): void {
    const currentDocs = this.toArray();
    this.previousSnapshot = new Map(currentDocs.map((d) => [d.id, { ...d }]));
  }
}
