import * as Automerge from '@automerge/automerge';

export class AutomergeDocumentStore<T extends { id: string }> {
  private docs = new Map<string, Automerge.Doc<T>>();
  private dirtyDocs = new Set<string>();
  private listeners = new Set<(docs: T[]) => void>();

  create(id: string, data: Omit<T, 'id'>): Uint8Array {
    const doc = Automerge.from({ ...data, id } as T);
    this.docs.set(id, doc);
    this.dirtyDocs.add(id);
    this.notify();
    return Automerge.save(doc);
  }

  change(id: string, updateFn: (draft: T) => void): Uint8Array | null {
    const doc = this.docs.get(id);
    if (!doc) return null;

    const newDoc = Automerge.change(doc, updateFn);
    this.docs.set(id, newDoc);
    this.dirtyDocs.add(id);
    this.notify();

    return Automerge.getChanges(doc, newDoc)[0] || null;
  }

  remove(id: string): Uint8Array | null {
    return this.change(id, (draft) => {
      (draft as T & { _deleted?: boolean })._deleted = true;
    });
  }

  merge(id: string, bytes: Uint8Array): void {
    const existing = this.docs.get(id);
    const incoming = Automerge.load<T>(bytes);

    const merged = existing ? Automerge.merge(existing, incoming) : incoming;

    this.docs.set(id, merged);
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
      .filter((doc) => !(doc as T & { _deleted?: boolean })._deleted);
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
