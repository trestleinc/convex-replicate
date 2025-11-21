export { defineReplicate } from './builder.js';
export { replicatedTable, type ReplicationFields } from './schema.js';

export {
  ComponentWriteError,
  MainTableWriteError,
  VersionConflictError,
  DualStorageError,
  CRDTEncodingError,
} from './errors.js';
