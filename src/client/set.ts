import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import { getStoredProtocolVersion, migrateLocalStorage, storeProtocolVersion } from './protocol.js';
import { getLogger } from './logger.js';

const logger = getLogger(['convex-replicate', 'set']);

let setPromise: Promise<void> | null = null;
let isSet = false;

export interface SetOptions {
  convexClient: ConvexClient;
  api?: {
    protocol?: FunctionReference<'query'>;
  };
}

export async function setReplicate(options: SetOptions): Promise<void> {
  const { convexClient, api } = options;

  logger.info('Setting up Replicate client');

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
    logger.info('Replicate setup complete', { version: serverVersion });
  } catch (error) {
    logger.error('Failed to set up Replicate', { error });
    throw new Error(
      `Replicate setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export function ensureSet(options: SetOptions): Promise<void> {
  if (isSet) {
    return Promise.resolve();
  }

  if (setPromise) {
    return setPromise;
  }

  logger.debug('Auto-setting up Replicate (lazy setup)');

  setPromise = setReplicate(options)
    .then(() => {
      isSet = true;
      logger.info('Replicate auto-setup successful');
    })
    .catch((error) => {
      setPromise = null;
      logger.error('Auto-setup failed', { error });

      throw new Error(
        `Replicate auto-setup failed: ${error instanceof Error ? error.message : 'Unknown error'}\n` +
          'This likely means the replicate component is not installed in your Convex backend.\n' +
          'See: https://github.com/trestleinc/convex-replicate#installation'
      );
    });

  return setPromise;
}

export function resetSetState(): void {
  setPromise = null;
  isSet = false;
  logger.debug('Set state reset');
}

async function getServerProtocolVersion(
  convexClient: ConvexClient,
  api?: SetOptions['api']
): Promise<number> {
  try {
    if (api?.protocol) {
      const result = await convexClient.query(api.protocol, {});
      return result.protocolVersion;
    }

    throw new Error(
      'No protocol version endpoint provided. Add a protocol query wrapper in your Convex app:\n\n' +
        'export const protocol = query({\n  handler: async (ctx) => {\n    return await ctx.runQuery(components.replicate.public.protocol);\n  },\n});\n\n' +
        'Then pass it to setReplicate:\n' +
        'await setReplicate({ convexClient, api: { protocol: api.replicate.protocol } });'
    );
  } catch (error) {
    logger.error('Failed to get server protocol version', { error });
    throw error;
  }
}
export async function getProtocolInfo(
  convexClient: ConvexClient,
  api?: SetOptions['api']
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

export async function resetProtocolStorage(): Promise<void> {
  const { clearProtocolStorage } = await import('./protocol.js');
  await clearProtocolStorage();
  logger.info('Protocol storage reset');
}
