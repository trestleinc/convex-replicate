import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import { Effect } from 'effect';
import {
  ProtocolService,
  ProtocolServiceLive,
  ensureProtocolVersion,
} from './services/ProtocolService.js';
import { getLogger } from './logger.js';

const logger = getLogger(['replicate', 'set']);

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
    if (!api?.protocol) {
      throw new Error(
        'No protocol version endpoint provided. Add a protocol query wrapper in your Convex app:\n\n' +
          'export const protocol = query({\n  handler: async (ctx) => {\n    return await ctx.runQuery(components.replicate.public.protocol);\n  },\n});\n\n' +
          'Then pass it to setReplicate:\n' +
          'await setReplicate({ convexClient, api: { protocol: api.replicate.protocol } });'
      );
    }

    // Use ProtocolService via ensureProtocolVersion (Effect-based)
    const version = await Effect.runPromise(
      ensureProtocolVersion(convexClient, { protocol: api.protocol })
    );

    logger.info('Replicate setup complete', { version });
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
          'See: https://github.com/trestleinc/replicate#installation'
      );
    });

  return setPromise;
}

export function resetSetState(): void {
  setPromise = null;
  isSet = false;
  logger.debug('Set state reset');
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
    if (!api?.protocol) {
      throw new Error('Protocol API endpoint required for getProtocolInfo');
    }

    // Use ProtocolService for consistent storage access
    const protocolLayer = ProtocolServiceLive(convexClient, { protocol: api.protocol });

    const { serverVersion, localVersion } = await Effect.runPromise(
      Effect.gen(function* () {
        const protocol = yield* ProtocolService;
        const server = yield* protocol.getServerVersion();
        const local = yield* protocol.getStoredVersion();
        return { serverVersion: server, localVersion: local };
      }).pipe(Effect.provide(protocolLayer))
    );

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

export async function resetProtocolStorage(
  convexClient: ConvexClient,
  api: { protocol: FunctionReference<'query'> }
): Promise<void> {
  const protocolLayer = ProtocolServiceLive(convexClient, { protocol: api.protocol });

  await Effect.runPromise(
    Effect.gen(function* () {
      const protocol = yield* ProtocolService;
      yield* protocol.clearStorage();
    }).pipe(Effect.provide(protocolLayer))
  );

  logger.info('Protocol storage reset');
}
