import type { AutomergeDocumentStore } from '@convex-rx/core';

export type CollectionStatus = 'idle' | 'loading' | 'ready' | 'error' | 'cleanedUp';

export interface ChangeMessage<T> {
  type: 'insert' | 'update' | 'delete';
  key: string;
  item?: T;
}

export class AutomergeCollection<T extends { id: string }> {
  private _status: CollectionStatus = 'idle';
  private listeners = new Set<() => void>();
  private _cachedArray: T[] = [];

  constructor(public readonly store: AutomergeDocumentStore<T>) {
    this.store.subscribe(() => {
      this.updateCache();
      this.notifyListeners();
    });
  }

  async initialize(): Promise<void> {
    this._status = 'loading';
    this.notifyListeners();

    try {
      await this.store.initialize();
      this._status = 'ready';
      this.updateCache();
    } catch {
      this._status = 'error';
    }

    this.notifyListeners();
  }

  get state(): Map<string, T> {
    const map = new Map<string, T>();
    for (const item of this._cachedArray) {
      map.set(item.id, item);
    }
    return map;
  }

  get toArray(): T[] {
    return this._cachedArray;
  }

  private updateCache(): void {
    this._cachedArray = this.store.toArray();
  }

  get status(): CollectionStatus {
    return this._status;
  }

  get size(): number {
    return this._cachedArray.length;
  }

  get isIdle(): boolean {
    return this._status === 'idle';
  }

  get isLoading(): boolean {
    return this._status === 'loading';
  }

  get isReady(): boolean {
    return this._status === 'ready';
  }

  get isError(): boolean {
    return this._status === 'error';
  }

  get isCleanedUp(): boolean {
    return this._status === 'cleanedUp';
  }

  insert(item: T): void {
    if (!item.id) {
      throw new Error('Item must have an id property');
    }
    this.store.create(item.id, item as Omit<T, 'id'>);
  }

  update(id: string, updateFn: (draft: T) => void): void {
    this.store.change(id, updateFn);
  }

  delete(id: string): void {
    this.store.remove(id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    const storeUnsubscribe = this.store.subscribe(() => {
      listener();
    });

    return () => {
      this.listeners.delete(listener);
      storeUnsubscribe();
    };
  }

  cleanup(): void {
    this._status = 'cleanedUp';
    this.listeners.clear();
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
