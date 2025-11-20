/**
 * Effect-based mutation functions for dual-storage operations.
 *
 * These functions implement the core mutation logic using Effect.ts for
 * structured error handling and observability. They are used internally
 * by the Replicate class but can also be used directly for custom workflows.
 *
 * @module mutations
 */

export { insertDocumentEffect } from './insert.js';
export { updateDocumentEffect } from './update.js';
export { deleteDocumentEffect } from './delete.js';
