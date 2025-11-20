import { Data } from 'effect';

// ============================================================================
// Tagged Errors for Server-Side Operations
// ============================================================================

/**
 * Component write failed (event log append)
 */
export class ComponentWriteError extends Data.TaggedError('ComponentWriteError')<{
  readonly collection: string;
  readonly documentId: string;
  readonly operation: 'insert' | 'update' | 'delete';
  readonly cause: unknown;
}> {}

/**
 * Main table write failed (materialized view)
 */
export class MainTableWriteError extends Data.TaggedError('MainTableWriteError')<{
  readonly table: string;
  readonly documentId: string;
  readonly operation: 'insert' | 'update' | 'delete';
  readonly cause: unknown;
}> {}

/**
 * Version conflict detected during optimistic concurrency control
 */
export class VersionConflictError extends Data.TaggedError('VersionConflictError')<{
  readonly documentId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;
}> {}

/**
 * Dual-storage transaction failed (both writes must succeed or both fail)
 */
export class DualStorageError extends Data.TaggedError('DualStorageError')<{
  readonly collection: string;
  readonly documentId: string;
  readonly componentSuccess: boolean;
  readonly mainTableSuccess: boolean;
  readonly cause: unknown;
}> {}

/**
 * CRDT encoding/decoding error
 */
export class CRDTEncodingError extends Data.TaggedError('CRDTEncodingError')<{
  readonly documentId: string;
  readonly operation: 'encode' | 'decode';
  readonly cause: unknown;
}> {}
