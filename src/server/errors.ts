import { Data } from 'effect';

export class ComponentWriteError extends Data.TaggedError('ComponentWriteError')<{
  readonly collection: string;
  readonly documentId: string;
  readonly operation: 'insert' | 'update' | 'delete';
  readonly cause: unknown;
}> {}

export class MainTableWriteError extends Data.TaggedError('MainTableWriteError')<{
  readonly table: string;
  readonly documentId: string;
  readonly operation: 'insert' | 'update' | 'delete';
  readonly cause: unknown;
}> {}

export class VersionConflictError extends Data.TaggedError('VersionConflictError')<{
  readonly documentId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;
}> {}

export class DualStorageError extends Data.TaggedError('DualStorageError')<{
  readonly collection: string;
  readonly documentId: string;
  readonly componentSuccess: boolean;
  readonly mainTableSuccess: boolean;
  readonly cause: unknown;
}> {}

export class CRDTEncodingError extends Data.TaggedError('CRDTEncodingError')<{
  readonly documentId: string;
  readonly operation: 'encode' | 'decode';
  readonly cause: unknown;
}> {}
