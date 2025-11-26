/**
 * Replicate Helpers - Plain functions for TanStack DB optimistic updates
 *
 * Simple module-level state for sync operations.
 */

export interface ReplicateParams {
  readonly begin: () => void;
  readonly write: (message: { type: 'insert' | 'update' | 'delete'; value: unknown }) => void;
  readonly commit: () => void;
  readonly truncate: () => void;
}

// Module-level state - shared across all callers
let replicateParams: ReplicateParams | null = null;

export function initializeReplicateParams(params: ReplicateParams): void {
  replicateParams = params;
}

// Export for test cleanup
export function _resetReplicateParams(): void {
  replicateParams = null;
}

function ensureInitialized(): ReplicateParams {
  if (!replicateParams) {
    throw new Error('ReplicateParams not initialized - call initializeReplicateParams() first');
  }
  return replicateParams;
}

export function replicateInsert<T>(items: T[]): void {
  const params = ensureInitialized();
  params.begin();
  for (const item of items) {
    params.write({ type: 'insert', value: item });
  }
  params.commit();
}

export function replicateUpdate<T>(items: T[]): void {
  const params = ensureInitialized();
  params.begin();
  for (const item of items) {
    params.write({ type: 'update', value: item });
  }
  params.commit();
}

export function replicateDelete<T>(items: T[]): void {
  const params = ensureInitialized();
  params.begin();
  for (const item of items) {
    params.write({ type: 'delete', value: item });
  }
  params.commit();
}

// Upsert uses 'update' type - TanStack DB only recognizes insert/update/delete
export function replicateUpsert<T>(items: T[]): void {
  const params = ensureInitialized();
  params.begin();
  for (const item of items) {
    params.write({ type: 'update', value: item });
  }
  params.commit();
}

export function replicateTruncate(): void {
  const params = ensureInitialized();
  params.truncate();
}

export function replicateReplace<T>(items: T[]): void {
  const params = ensureInitialized();
  params.truncate();
  params.begin();
  for (const item of items) {
    params.write({ type: 'insert', value: item });
  }
  params.commit();
}
