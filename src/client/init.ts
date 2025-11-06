/**
 * Client initialization with protocol version checking
 *
 * Call this once on app startup to ensure client/server compatibility
 * and migrate local storage when needed.
 */

import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import { getLogger } from './logger.js';
import {
  getStoredProtocolVersion,
  storeProtocolVersion,
  migrateLocalStorage,
} from './protocol-migration.js';

const logger = getLogger(['convex-replicate', 'init']);

/**
 * Client protocol version (matches component PROTOCOL_VERSION)
 * Increment when NPM package makes breaking API changes
 */
export const CLIENT_PROTOCOL_VERSION = 1;

/**
 * Initialize ConvexReplicate client
 * - Checks for local storage version changes (NPM package update)
 * - Migrates IndexedDB if needed
 * - Verifies server compatibility
 *
 * @param convexClient - Convex client instance
 * @param checkProtocolVersionFn - Reference to component's checkProtocolVersion query
 *
 * @throws Error if client/server versions are incompatible
 *
 * @example
 * ```typescript
 * import { ConvexClient } from 'convex/browser';
 * import { api } from '../convex/_generated/api';
 * import { initializeConvexReplicate } from '@trestleinc/replicate/client';
 *
 * const convexClient = new ConvexClient(import.meta.env.VITE_CONVEX_URL);
 *
 * // Call once on app startup
 * await initializeConvexReplicate(
 *   convexClient,
 *   api.replicate.checkProtocolVersion
 * );
 * ```
 */
export async function initializeConvexReplicate(
  convexClient: ConvexClient,
  checkProtocolVersionFn: FunctionReference<'query'>
): Promise<void> {
  logger.info('Initializing ConvexReplicate', {
    clientVersion: CLIENT_PROTOCOL_VERSION,
  });

  // Step 1: Check local storage version (detects NPM package update)
  const storedVersion = await getStoredProtocolVersion();

  if (storedVersion < CLIENT_PROTOCOL_VERSION) {
    logger.info('Protocol version changed - migrating local storage', {
      from: storedVersion,
      to: CLIENT_PROTOCOL_VERSION,
    });

    await migrateLocalStorage(storedVersion, CLIENT_PROTOCOL_VERSION);
    await storeProtocolVersion(CLIENT_PROTOCOL_VERSION);

    logger.info('Local storage migration complete');
  } else if (storedVersion === CLIENT_PROTOCOL_VERSION) {
    logger.debug('Protocol version unchanged', { version: storedVersion });
  }

  // Step 2: Check server compatibility
  const serverCheck = await convexClient.query(checkProtocolVersionFn, {
    clientVersion: CLIENT_PROTOCOL_VERSION,
  });

  if (!serverCheck.compatible) {
    const message = serverCheck.upgradeRequired
      ? `Server requires @trestleinc/replicate v${serverCheck.serverVersion}. ` +
        `Please update: npm install @trestleinc/replicate@latest\n` +
        `Your local changes are preserved and will sync after updating.`
      : `Client version ${CLIENT_PROTOCOL_VERSION} is newer than server version ${serverCheck.serverVersion}. ` +
        `Please wait for server deployment or downgrade the package.`;

    logger.error('Protocol version mismatch', {
      clientVersion: CLIENT_PROTOCOL_VERSION,
      serverVersion: serverCheck.serverVersion,
    });

    throw new Error(message);
  }

  logger.info('Protocol version compatible', {
    clientVersion: CLIENT_PROTOCOL_VERSION,
    serverVersion: serverCheck.serverVersion,
  });
}
