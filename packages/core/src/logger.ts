// ========================================
// LOGGING ABSTRACTION
// ========================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

/**
 * Creates a namespaced logger that can be enabled/disabled
 * @param namespace - Logger namespace (e.g., collection name)
 * @param enabled - Whether logging is enabled
 * @returns Logger instance
 */
export function createLogger(namespace: string, enabled: boolean = true): Logger {
  const noop = () => {};

  if (!enabled) {
    return {
      debug: noop,
      info: noop,
      warn: noop,
      error: (...args) => console.error(`[${namespace}]`, ...args), // Always log errors
    };
  }

  return {
    debug: (...args) => console.debug(`[${namespace}]`, ...args),
    info: (...args) => console.log(`[${namespace}]`, ...args),
    warn: (...args) => console.warn(`[${namespace}]`, ...args),
    error: (...args) => console.error(`[${namespace}]`, ...args),
  };
}
