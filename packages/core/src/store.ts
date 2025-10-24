import * as Automerge from '@automerge/automerge';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';

type DeletableDocument = { _deleted?: boolean };

export class AutomergeDocumentStore<T extends { id: string }> {
  private docs = new Map<string, Automerge.Doc<T>>();
  private dirtyDocs = new Set<string>();
  private listeners = new Set<(docs: T[]) => void>();
  private isInitialized = false;
  private storage: IndexedDBStorageAdapter;

  constructor(collectionName: string) {
    this.storage = new IndexedDBStorageAdapter(`convex-replicate-${collectionName}`);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const chunks = await this.storage.loadRange([]);

      for (const chunk of chunks) {
        const [id] = chunk.key;
        if (!id || !chunk.data) continue;

        try {
          const doc = Automerge.load<T>(chunk.data);
          this.docs.set(id, doc);
        } catch {
          // Skip corrupted data
        }
      }
    } catch {
      // If storage fails (e.g., SSR), continue without persistence
    }

    this.isInitialized = true;
    this.notify();
  }

  private async persistToIndexedDB(id: string, bytes: Uint8Array): Promise<void> {
    try {
      await this.storage.save([id], bytes);
    } catch {
      // Ignore persistence errors (e.g., in SSR)
    }
  }

  create(id: string, data: Omit<T, 'id'>): Uint8Array {
    const doc = Automerge.from({ ...data, id } as T);
    this.docs.set(id, doc);
    this.dirtyDocs.add(id);
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
    this.dirtyDocs.add(id);
    const bytes = Automerge.save(newDoc);
    void this.persistToIndexedDB(id, bytes);
    this.notify();

    return bytes;
  }

  remove(id: string): Uint8Array | null {
    return this.change(id, (draft) => {
      (draft as T & DeletableDocument)._deleted = true;
    });
  }

  merge(id: string, bytes: Uint8Array): void {
    const existing = this.docs.get(id);
    const incoming = Automerge.load<T>(bytes);

    const merged = existing ? Automerge.merge(existing, incoming) : incoming;

    this.docs.set(id, merged);
    const mergedBytes = Automerge.save(merged);
    void this.persistToIndexedDB(id, mergedBytes);
    this.notify();
  }

  getDirty(): Array<{ id: string; bytes: Uint8Array }> {
    return Array.from(this.dirtyDocs)
      .map((id) => {
        const doc = this.docs.get(id);
        return doc ? { id, bytes: Automerge.save(doc) } : null;
      })
      .filter((item): item is { id: string; bytes: Uint8Array } => item !== null);
  }

  clearDirty(id: string): void {
    this.dirtyDocs.delete(id);
  }

  toArray(): T[] {
    return Array.from(this.docs.values())
      .map((doc) => ({ ...doc }))
      .filter((doc) => {
        const deletable = doc as T & DeletableDocument;
        return !deletable._deleted;
      });
  }

  subscribe(fn: (docs: T[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const data = this.toArray();
    for (const fn of this.listeners) {
      fn(data);
    }
  }
}
