import type { ConvexRxDocument } from './types';

// ========================================
// CONFLICT RESOLUTION TYPES
// ========================================

export interface RxConflictHandlerInput<T> {
  /** The current state of the document on the master (server) */
  realMasterState: T;
  /** The state that the client assumed was on the master before making changes */
  assumedMasterState?: T;
  /** The new state the client is trying to write */
  newDocumentState: T;
}

export interface RxConflictHandler<T> {
  /**
   * Determines if two document states are equal.
   * Used to detect conflicts - if equal, no conflict exists.
   * For performance, consider comparing only key fields like updatedTime
   * instead of deep equality checks.
   */
  isEqual: (docA: T, docB: T) => boolean;

  /**
   * Resolves a conflict by returning the document state to use.
   * Can be async to allow for UI prompts or complex merge logic.
   */
  resolve: (input: RxConflictHandlerInput<T>) => Promise<T> | T;
}

// ========================================
// BUILT-IN CONFLICT RESOLUTION STRATEGIES
// ========================================

/**
 * Server-wins strategy: Always use the server's state.
 * Safest option - ensures consistency across all clients.
 * Local changes are discarded when conflicts occur.
 */
export function createServerWinsHandler<T extends ConvexRxDocument>(): RxConflictHandler<T> {
  return {
    isEqual(docA, docB) {
      // Compare updatedTime for efficient conflict detection
      return docA.updatedTime === docB.updatedTime;
    },
    resolve(input) {
      // Always use server state
      return input.realMasterState;
    },
  };
}

/**
 * Client-wins strategy: Always use the client's state.
 * WARNING: Can lead to data loss if multiple clients edit simultaneously.
 * Use only when you're certain conflicts should be resolved by overwriting server data.
 */
export function createClientWinsHandler<T extends ConvexRxDocument>(): RxConflictHandler<T> {
  return {
    isEqual(docA, docB) {
      return docA.updatedTime === docB.updatedTime;
    },
    resolve(input) {
      // Always use client state
      return input.newDocumentState;
    },
  };
}

/**
 * Last-write-wins strategy: Use whichever document has the newest updatedTime.
 * Common strategy for timestamp-based conflict resolution.
 * Ensures the most recent change wins, regardless of where it came from.
 */
export function createLastWriteWinsHandler<T extends ConvexRxDocument>(): RxConflictHandler<T> {
  return {
    isEqual(docA, docB) {
      return docA.updatedTime === docB.updatedTime;
    },
    resolve(input) {
      // Compare timestamps and use the newer one
      if (input.newDocumentState.updatedTime > input.realMasterState.updatedTime) {
        return input.newDocumentState;
      }
      return input.realMasterState;
    },
  };
}

/**
 * Custom merge strategy: Merge properties from both states.
 * Allows field-level conflict resolution.
 *
 * @param mergeFunction - Custom function to merge document states
 */
export function createCustomMergeHandler<T extends ConvexRxDocument>(
  mergeFunction: (input: RxConflictHandlerInput<T>) => T
): RxConflictHandler<T> {
  return {
    isEqual(docA, docB) {
      return docA.updatedTime === docB.updatedTime;
    },
    resolve(input) {
      return mergeFunction(input);
    },
  };
}

// ========================================
// DEFAULT CONFLICT HANDLER
// ========================================

/**
 * Default conflict handler using last-write-wins strategy.
 * This is a good balance between simplicity and preventing data loss.
 */
export const defaultConflictHandler = createLastWriteWinsHandler();
