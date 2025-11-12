/**
 * Shared types and constants between client and server.
 * This file contains ONLY pure TypeScript - no Convex functions.
 */

/**
 * Operation types for CRDT stream responses.
 * Used by both client (to handle operations) and server (to tag operations).
 */
export enum OperationType {
  Delta = 'delta', // Regular incremental delta
  Diff = 'diff', // State vector diff (gap recovery with offline changes preserved)
  Snapshot = 'snapshot', // Full snapshot (fallback for clients without state vector)
}
