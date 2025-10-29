/**
 * @convex-replicate/component - CRDT replication component for Convex Replicate
 *
 * This component provides binary storage for CRDT data (snapshots and changes)
 * with deduplication and efficient querying.
 *
 * Usage:
 * ```typescript
 * import { components } from "./_generated/api";
 *
 * // Submit a snapshot
 * await ctx.runMutation(components.storage.submitSnapshot, {
 *   collectionName: "tasks",
 *   documentId: "task-123",
 *   data: automergeBytes
 * });
 *
 * // Pull changes
 * const result = await ctx.runQuery(components.storage.pullChanges, {
 *   collectionName: "tasks",
 *   checkpoint: { lastModified: 0 },
 *   limit: 100
 * });
 * ```
 */

export { api } from '../component/_generated/api';
