export { defineReplicate } from '$/server/builder.js';
export { replicatedTable, type ReplicationFields } from '$/server/schema.js';

export {
  ComponentWriteError,
  MainTableWriteError,
  VersionConflictError,
  DualStorageError,
  CRDTEncodingError,
} from '$/server/errors.js';
