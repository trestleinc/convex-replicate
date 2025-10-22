/**
 * LogTape integration for ConvexRx
 *
 * This module provides a simplified interface to LogTape for ConvexRx packages.
 * LogTape is a zero-dependency, universally compatible logging library.
 *
 * @see https://github.com/dahlia/logtape
 */

import { type Logger, getLogger as getLogTapeLogger } from '@logtape/logtape';

// Re-export LogTape types and utilities for advanced users
export type { Logger } from '@logtape/logtape';
export {
  type Config,
  type LogLevel,
  type Sink,
  configure,
  getConsoleSink,
  getLogger as getLogTapeLogger,
} from '@logtape/logtape';

/**
 * Get a logger for a ConvexRx component.
 * Uses hierarchical categories for organized logging.
 *
 * @param component - Component name (e.g., 'rxdb', 'replication', 'sync')
 * @param enabled - Whether logging is enabled (default: true)
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const logger = getLogger('replication', true);
 * logger.info('Starting sync', { batchSize: 50 });
 * logger.error('Sync failed', { error: err });
 * ```
 */
export function getLogger(component: string, enabled = true): Logger {
  const logger = getLogTapeLogger(['convex-rx', component]);

  if (!enabled) {
    // Return a no-op logger that implements the full Logger interface
    // IMPORTANT: Always log errors and fatals even when logging disabled
    const noop = () => {};
    return {
      ...logger,
      debug: noop,
      info: noop,
      warn: noop,
      // Keep error and fatal logging even when disabled
      error: logger.error,
      fatal: logger.fatal,
    };
  }

  return logger;
}
