import type { ConvexRxDocument } from './types';
import { getLogger } from './logger';

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
export function createServerWinsHandler<T extends ConvexRxDocument>(
  enableLogging = false
): RxConflictHandler<T> {
  const logger = getLogger('conflict-handler', enableLogging);

  return {
    isEqual(docA, docB) {
      // Compare updatedTime for efficient conflict detection
      return docA.updatedTime === docB.updatedTime;
    },
    resolve(input) {
      logger.debug('Server-wins conflict resolution', {
        documentId: input.realMasterState.id,
      });
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
export function createClientWinsHandler<T extends ConvexRxDocument>(
  enableLogging = false
): RxConflictHandler<T> {
  const logger = getLogger('conflict-handler', enableLogging);

  return {
    isEqual(docA, docB) {
      return docA.updatedTime === docB.updatedTime;
    },
    resolve(input) {
      logger.debug('Client-wins conflict resolution', {
        documentId: input.newDocumentState.id,
      });
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
export function createLastWriteWinsHandler<T extends ConvexRxDocument>(
  enableLogging = false
): RxConflictHandler<T> {
  const logger = getLogger('conflict-handler', enableLogging);

  return {
    isEqual(docA, docB) {
      return docA.updatedTime === docB.updatedTime && docA.id === docB.id;
    },
    resolve(input) {
      const newTime = input.newDocumentState.updatedTime;
      const realTime = input.realMasterState.updatedTime;

      if (newTime > realTime) {
        logger.debug('Last-write-wins: client wins', {
          documentId: input.newDocumentState.id,
          clientTime: newTime,
          serverTime: realTime,
        });
        return input.newDocumentState;
      }

      if (newTime < realTime) {
        logger.debug('Last-write-wins: server wins', {
          documentId: input.realMasterState.id,
          clientTime: newTime,
          serverTime: realTime,
        });
        return input.realMasterState;
      }

      logger.info('Timestamp collision, using ID as tie-breaker', {
        newId: input.newDocumentState.id,
        realId: input.realMasterState.id,
        timestamp: newTime,
      });

      return input.newDocumentState.id > input.realMasterState.id
        ? input.newDocumentState
        : input.realMasterState;
    },
  };
}

/**
 * Custom merge strategy: Merge properties from both states.
 * Allows field-level conflict resolution with error handling.
 * Supports both synchronous and asynchronous merge functions.
 *
 * @param mergeFunction - Custom function to merge document states (can be async)
 * @param options - Configuration options
 * @param options.onError - Callback when merge function throws (can be async)
 * @param options.fallbackStrategy - Strategy to use when merge fails ('server-wins' or 'client-wins')
 * @param options.enableLogging - Enable logging for debugging (default: true)
 *
 * @example Async merge with UI prompt
 * ```typescript
 * createCustomMergeHandler(
 *   async (input) => {
 *     const userChoice = await showConflictDialog(input);
 *     return userChoice === 'keep-local'
 *       ? input.newDocumentState
 *       : input.realMasterState;
 *   },
 *   { enableLogging: true }
 * )
 * ```
 */
export function createCustomMergeHandler<T extends ConvexRxDocument>(
  mergeFunction: (input: RxConflictHandlerInput<T>) => T | Promise<T>,
  options?: {
    onError?: (error: Error, input: RxConflictHandlerInput<T>) => void | Promise<void>;
    fallbackStrategy?: 'server-wins' | 'client-wins';
    enableLogging?: boolean;
    isEqual?: (docA: T, docB: T) => boolean;
  }
): RxConflictHandler<T> {
  const fallback = options?.fallbackStrategy ?? 'server-wins';
  const logger = getLogger('conflict-handler', options?.enableLogging ?? true);

  return {
    isEqual: options?.isEqual ?? ((docA, docB) => docA.updatedTime === docB.updatedTime),
    async resolve(input) {
      try {
        logger.debug('Custom merge conflict resolution started', {
          documentId: input.newDocumentState.id,
          realMasterTime: input.realMasterState?.updatedTime,
          newDocumentTime: input.newDocumentState.updatedTime,
        });

        // Support both sync and async merge functions using Promise.resolve
        const result = await Promise.resolve(mergeFunction(input));

        logger.debug('Custom merge conflict resolution succeeded', {
          documentId: result.id,
        });

        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // Log error with context using logger
        logger.error('Conflict handler error', {
          error: err.message,
          stack: err.stack,
          documentId: input.newDocumentState.id,
          realMasterTime: input.realMasterState?.updatedTime,
          newDocumentTime: input.newDocumentState.updatedTime,
        });

        // Call error callback if provided (support async)
        if (options?.onError) {
          try {
            await Promise.resolve(options.onError(err, input));
          } catch (callbackError) {
            logger.error('Error in conflict handler error callback', {
              callbackError,
            });
          }
        }

        // Fallback strategy with safer null coalescing
        const fallbackDoc =
          fallback === 'server-wins'
            ? input.realMasterState ?? input.newDocumentState
            : input.newDocumentState;

        logger.warn(`Falling back to ${fallback} strategy`, {
          documentId: fallbackDoc.id,
        });

        return fallbackDoc;
      }
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
