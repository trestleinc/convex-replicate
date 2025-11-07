/**
 * ConvexReplicate Client Initialization
 *
 * Handles protocol version checking and local storage migration.
 * This should be called once when your application starts.
 */

import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import { getStoredProtocolVersion, migrateLocalStorage, storeProtocolVersion } from './protocol.js';
import { getLogger } from './logger.js';

const logger = getLogger(['convex-replicate', 'init']);

/**
 * Global initialization state for lazy initialization
 * @internal
 */
let initPromise: Promise<void> | null = null;
let isInitialized = false;

/**
 * Configuration options for ConvexReplicate initialization
 */
export interface InitOptions {
  /** ConvexClient instance */
  convexClient: ConvexClient;
  /** Custom API endpoints (optional) */
  api?: {
    getProtocolVersion?: FunctionReference<'query'>;
  };
}

/**
 * Initialize ConvexReplicate client
 *
 * This function:
 * 1. Checks the server's protocol version
 * 2. Compares with the locally stored version
 * 3. Runs migrations if needed
 * 4. Updates the stored version
 *
 * **Note:** Initialization happens automatically when you create your first collection.
 * You only need to call this manually if you want to:
 * - Control exactly when initialization happens
 * - Handle initialization errors explicitly
 * - Use custom API endpoints
 *
 * @example
 * ```typescript
 * // Automatic initialization (recommended)
 * const collection = createConvexCollection(rawCollection); // Auto-initializes
 *
 * // Manual initialization (optional, for advanced use cases)
 * import { ConvexClient } from 'convex/browser';
 * import { initConvexReplicate } from '@trestleinc/replicate/client';
 *
 * const convexClient = new ConvexClient(process.env.VITE_CONVEX_URL!);
 * await initConvexReplicate({ convexClient });
 *
 * // Now create collections
 * const collection = createConvexCollection(rawCollection);
 * ```
 */
export async function initConvexReplicate(options: InitOptions): Promise<void> {
  const { convexClient, api } = options;

  logger.info('Initializing ConvexReplicate client');

  try {
    // Step 1: Get server protocol version
    const serverVersion = await getServerProtocolVersion(convexClient, api);
    logger.debug('Server protocol version', { version: serverVersion });

    // Step 2: Get locally stored version
    const localVersion = await getStoredProtocolVersion();
    logger.debug('Local protocol version', { version: localVersion });

    // Step 3: Check if migration is needed
    if (serverVersion < localVersion) {
      logger.warn('Server protocol version is older than local version', {
        serverVersion,
        localVersion,
      });
      // This is unusual but not necessarily an error - could be rolling back
      // We'll store the server version but won't "downgrade"
    } else if (serverVersion > localVersion) {
      logger.info('Protocol upgrade detected, running migration', {
        from: localVersion,
        to: serverVersion,
      });

      // Step 4: Run migration if needed
      await migrateLocalStorage(localVersion, serverVersion);
    } else {
      logger.debug('Protocol versions match, no migration needed');
    }

    // Step 5: Store the current version
    await storeProtocolVersion(serverVersion);
    logger.info('ConvexReplicate initialization complete', { version: serverVersion });
  } catch (error) {
    logger.error('Failed to initialize ConvexReplicate', { error });
    throw new Error(
      `ConvexReplicate initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Ensure ConvexReplicate is initialized (lazy initialization)
 *
 * This function is called automatically when creating collections.
 * It ensures initialization runs exactly once, even if multiple
 * collections are created concurrently.
 *
 * @internal Used by convexCollectionOptions
 */
export function ensureInitialized(options: InitOptions): Promise<void> {
  // Already initialized - return immediately
  if (isInitialized) {
    return Promise.resolve();
  }

  // Initialization in progress - return existing promise
  if (initPromise) {
    return initPromise;
  }

  // Start initialization
  logger.debug('Auto-initializing ConvexReplicate (lazy initialization)');

  initPromise = initConvexReplicate(options)
    .then(() => {
      isInitialized = true;
      logger.info('ConvexReplicate auto-initialized successfully');
    })
    .catch((error) => {
      // Reset state to allow retry on next call
      initPromise = null;
      logger.error('Auto-initialization failed', { error });

      throw new Error(
        `ConvexReplicate auto-initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}\n` +
          'This likely means the replicate component is not installed in your Convex backend.\n' +
          'See: https://github.com/trestleinc/convex-replicate#installation'
      );
    });

  return initPromise;
}

/**
 * Reset initialization state (for testing)
 *
 * @internal Used by tests to reset global state between test runs
 */
export function resetInitializationState(): void {
  initPromise = null;
  isInitialized = false;
  logger.debug('Initialization state reset');
}

/**
 * Get the server's protocol version
 */
async function getServerProtocolVersion(
  convexClient: ConvexClient,
  api?: InitOptions['api']
): Promise<number> {
  try {
    // Use custom API if provided
    if (api?.getProtocolVersion) {
      const result = await convexClient.query(api.getProtocolVersion, {});
      return result.protocolVersion;
    }

    // No default - user must provide getProtocolVersion wrapper
    throw new Error(
      'No protocol version endpoint provided. Add a getProtocolVersion query wrapper in your Convex app:\n\n' +
        'export const getProtocolVersion = query({\n  handler: async (ctx) => {\n    return await ctx.runQuery(components.replicate.public.getProtocolVersion);\n  },\n});\n\n' +
        'Then pass it to initConvexReplicate:\n' +
        'await initConvexReplicate({ convexClient, api: { getProtocolVersion: api.replicate.getProtocolVersion } });'
    );
  } catch (error) {
    logger.error('Failed to get server protocol version', { error });
    throw error;
  }
}

/**
 * Get current protocol version information (useful for debugging)
 */
export async function getProtocolInfo(
  convexClient: ConvexClient,
  api?: InitOptions['api']
): Promise<{
  serverVersion: number;
  localVersion: number;
  needsMigration: boolean;
}> {
  try {
    const serverVersion = await getServerProtocolVersion(convexClient, api);
    const localVersion = await getStoredProtocolVersion();

    return {
      serverVersion,
      localVersion,
      needsMigration: serverVersion > localVersion,
    };
  } catch (error) {
    logger.error('Failed to get protocol info', { error });
    throw error;
  }
}

/**
 * Reset local protocol storage (useful for testing or troubleshooting)
 *
 * @warning This will clear all protocol metadata and may cause data loss
 *          if used improperly. Only use this for testing or when explicitly
 *          resetting the application state.
 */
export async function resetProtocolStorage(): Promise<void> {
  const { clearProtocolStorage } = await import('./protocol.js');
  await clearProtocolStorage();
  logger.info('Protocol storage reset');
}
