import { Data } from 'effect';

// ============================================================================
// Connection Errors
// ============================================================================

export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly cause: unknown;
  readonly retryable: true;
  readonly operation: string;
}> {}

export class SubscriptionError extends Data.TaggedError('SubscriptionError')<{
  readonly collection: string;
  readonly checkpoint?: unknown;
  readonly cause: unknown;
}> {}

export class ReconnectionError extends Data.TaggedError('ReconnectionError')<{
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly lastError: unknown;
}> {}

export class ConnectionTimeoutError extends Data.TaggedError('ConnectionTimeoutError')<{
  readonly operation: string;
  readonly timeoutMs: number;
}> {}

// ============================================================================
// CRDT Errors
// ============================================================================

export class YjsApplicationError extends Data.TaggedError('YjsApplicationError')<{
  readonly documentId: string;
  readonly deltaSize: number;
  readonly cause: unknown;
}> {}

export class DeltaValidationError extends Data.TaggedError('DeltaValidationError')<{
  readonly documentId?: string;
  readonly version?: number;
  readonly reason: string;
}> {}

export class SnapshotError extends Data.TaggedError('SnapshotError')<{
  readonly collection: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

export class CorruptDeltaError extends Data.TaggedError('CorruptDeltaError')<{
  readonly documentId: string;
  readonly version: number;
  readonly crdtBytesSize: number;
}> {}

export class GapDetectedError extends Data.TaggedError('GapDetectedError')<{
  readonly collection: string;
  readonly checkpointTimestamp: number;
  readonly oldestDeltaTimestamp: number;
}> {}

// ============================================================================
// Storage Errors (IndexedDB)
// ============================================================================

export class IDBError extends Data.TaggedError('IDBError')<{
  readonly operation: 'get' | 'set' | 'delete' | 'clear';
  readonly store?: string;
  readonly key?: string;
  readonly cause: unknown;
}> {}

export class IDBWriteError extends Data.TaggedError('IDBWriteError')<{
  readonly key: string;
  readonly value: unknown;
  readonly cause: unknown;
}> {}

export class CheckpointError extends Data.TaggedError('CheckpointError')<{
  readonly collection: string;
  readonly operation: 'load' | 'save';
  readonly cause: unknown;
}> {}

// ============================================================================
// Protocol Errors
// ============================================================================

export class ProtocolVersionError extends Data.TaggedError('ProtocolVersionError')<{
  readonly expected: number;
  readonly actual: number;
  readonly canMigrate: boolean;
}> {}

export class MigrationError extends Data.TaggedError('MigrationError')<{
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly cause: unknown;
}> {}

export class ProtocolInitError extends Data.TaggedError('ProtocolInitError')<{
  readonly stage: 'load' | 'validate' | 'migrate' | 'store';
  readonly cause: unknown;
}> {}

// ============================================================================
// Convex Mutation Errors
// ============================================================================

export class AuthError extends Data.TaggedError('AuthError')<{
  readonly status: 401 | 403;
  readonly message: string;
  readonly operation: string;
}> {}

export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly status: 422;
  readonly fields?: Record<string, string>;
  readonly message: string;
}> {}

export class ConvexMutationError extends Data.TaggedError('ConvexMutationError')<{
  readonly mutation: string;
  readonly args: unknown;
  readonly status?: number;
  readonly cause: unknown;
}> {}

export class VersionConflictError extends Data.TaggedError('VersionConflictError')<{
  readonly documentId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;
}> {}

export class ReconciliationError extends Data.TaggedError('ReconciliationError')<{
  readonly collection: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

export class TabCoordinationError extends Data.TaggedError('TabCoordinationError')<{
  readonly operation: 'leader_election' | 'message_broadcast';
  readonly cause: unknown;
}> {}

export class ComponentError extends Data.TaggedError('ComponentError')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

// ============================================================================
// Error Type Guards
// ============================================================================

export const isRetriableError = (error: unknown): boolean => {
  if (error instanceof NetworkError) return error.retryable;
  if (error instanceof SubscriptionError) return true;
  if (error instanceof ConnectionTimeoutError) return true;
  if (error instanceof IDBError) return true;
  if (error instanceof ConvexMutationError)
    return error.status !== 422 && error.status !== 401 && error.status !== 403;
  return false;
};

export const isNonRetriableError = (error: unknown): boolean => {
  if (error instanceof AuthError) return true;
  if (error instanceof ValidationError) return true;
  if (error instanceof CorruptDeltaError) return true;
  if (error instanceof ProtocolVersionError && !error.canMigrate) return true;
  return false;
};
