import { Data } from 'effect';
import type { IDBError, IDBWriteError, ReconciliationError } from '../errors/index.js';
import type { YjsError } from './YjsService.js';
import type { SubscriptionError } from './SubscriptionService.js';
import type { OptimisticWriteError } from './OptimisticService.js';
import type { SnapshotMissingError, SnapshotRecoveryError } from './SnapshotService.js';

/**
 * OrchestratorError - High-level coordination errors
 */
export class OrchestratorError extends Data.TaggedError('OrchestratorError')<{
  operation: string;
  message: string;
}> {}

/**
 * SyncSystemError - Union of all possible errors from the sync system
 *
 * This allows consumers to use Effect.catchTags() to handle specific errors:
 *
 * @example
 * ```typescript
 * Effect.catchTags({
 *   IDBError: (error) => Effect.logError('Storage failed', error),
 *   SubscriptionError: (error) => Effect.logError('Subscription failed', error),
 *   // ... handle other specific errors
 * })
 * ```
 */
export type SyncSystemError =
  | OrchestratorError
  | IDBError
  | IDBWriteError
  | ReconciliationError
  | YjsError
  | SubscriptionError
  | OptimisticWriteError
  | SnapshotMissingError
  | SnapshotRecoveryError;
