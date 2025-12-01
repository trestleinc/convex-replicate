/**
 * Multi-Client Browser Commands
 *
 * Custom Vitest browser commands for testing multi-client scenarios.
 * These commands create isolated browser contexts (via Playwright's newContext())
 * ensuring each client has its own IndexedDB - critical for testing real-time
 * sync via Convex subscriptions rather than shared local storage.
 *
 * Usage:
 *   const { id: client1 } = await commands.createClient(convexUrl, 'tasks');
 *   const { id: client2 } = await commands.createClient(convexUrl, 'tasks');
 *   await commands.insertItem(client1, { id: 'x', text: 'hello', isCompleted: false });
 *   const item = await commands.waitForItem(client2, 'x'); // Via Convex, not IndexedDB!
 */

import type { BrowserCommand } from 'vitest/node';
import type { BrowserContext, Page } from 'playwright';

interface ClientInstance {
  context: BrowserContext;
  page: Page;
}

// Store all client instances by ID
const clients = new Map<string, ClientInstance>();

// Extended context type for Playwright provider (vitest doesn't export this)
interface PlaywrightCommandContext {
  context: BrowserContext;
  page: Page;
}

// Cached Vite URL for performance
let cachedViteUrl: string | null = null;

/**
 * Internal helper to create a single client.
 * Used by both createClient and createClients.
 */
async function createClientInternal(
  ctx: any,
  convexUrl: string,
  collectionName: string,
  timeoutMs = 30000
): Promise<{ id: string }> {
  if (ctx.provider.name !== 'playwright') {
    throw new Error('createClient requires Playwright provider');
  }

  const playwrightCtx = ctx.provider.getCommandsContext(
    ctx.sessionId
  ) as unknown as PlaywrightCommandContext;

  const browser = playwrightCtx.context.browser();
  if (!browser) {
    throw new Error('Could not access browser from Playwright context');
  }
  const newContext = await browser.newContext();
  const page = await newContext.newPage();

  // Cache Vite URL for subsequent calls
  if (!cachedViteUrl) {
    const projectBrowser = (ctx.project as any).browser;
    const viteServer = projectBrowser?.vite;
    const resolvedUrls = viteServer?.resolvedUrls;
    const localUrl = resolvedUrls?.local?.[0];
    const networkUrl = resolvedUrls?.network?.[0];
    cachedViteUrl = (localUrl || networkUrl || 'http://localhost:5173').replace(/\/$/, '');
  }

  const encodedUrl = encodeURIComponent(convexUrl);
  const encodedCollection = encodeURIComponent(collectionName);
  await page.goto(
    `${cachedViteUrl}/src/test/isolated-client.html?convexUrl=${encodedUrl}&collection=${encodedCollection}`
  );

  const id = crypto.randomUUID();

  // Only log errors in scale scenarios to reduce noise
  page.on('pageerror', (err) => console.error(`[Page ${id.slice(0, 8)}] Error:`, err.message));

  // Capture console logs for debugging - capture ALL logs from replicate module
  page.on('console', (msg) => {
    const text = msg.text();
    // Log our debug messages
    if (
      text.includes('[collection]') ||
      text.includes('[isolated-client]') ||
      text.includes('[replicate]') ||
      text.includes('REPLICATE') ||
      text.includes('replicateInsert') ||
      text.includes('replicateDelete') ||
      text.includes('replicateUpsert')
    ) {
      console.log(`[Page ${id.slice(0, 8)}]`, text);
    }
  });

  try {
    await page.waitForFunction(
      () => (window as any).__isReady__ === true || (window as any).__initError__,
      { timeout: timeoutMs }
    );

    const initError = await page.evaluate(() => (window as any).__initError__);
    if (initError) {
      throw new Error(`Client initialization failed: ${initError}`);
    }
  } catch (err) {
    await newContext.close();
    throw err;
  }

  clients.set(id, { context: newContext, page });
  return { id };
}

/**
 * Creates an isolated browser client with its own IndexedDB.
 * Returns a client ID for use in subsequent commands.
 */
export const createClient: BrowserCommand<[convexUrl: string, collectionName: string]> = async (
  ctx,
  convexUrl: string,
  collectionName: string
) => {
  return createClientInternal(ctx, convexUrl, collectionName);
};

/**
 * Batch creates N clients in parallel batches.
 * More efficient than calling createClient N times.
 * Default batch size is conservative (5) to avoid overwhelming Convex.
 */
export const createClients: BrowserCommand<
  [
    convexUrl: string,
    collectionName: string,
    count: number,
    options?: { parallelBatches?: number; initTimeoutMs?: number },
  ]
> = async (ctx, convexUrl, collectionName, count, options = {}) => {
  const { parallelBatches = 5, initTimeoutMs = 30000 } = options;
  const results = {
    ids: [] as string[],
    created: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (let i = 0; i < count; i += parallelBatches) {
    const batchSize = Math.min(parallelBatches, count - i);
    const batchPromises = Array.from({ length: batchSize }, async () => {
      try {
        const { id } = await createClientInternal(ctx, convexUrl, collectionName, initTimeoutMs);
        results.ids.push(id);
        results.created++;
      } catch (err: any) {
        results.failed++;
        results.errors.push(err.message || String(err));
      }
    });
    await Promise.all(batchPromises);
    // Delay between batches to avoid overwhelming the browser/Convex
    if (i + parallelBatches < count) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
};

/**
 * Waits for all clients to converge to expected item count.
 */
export const waitForConvergence: BrowserCommand<
  [clientIds: string[], expectedItemCount: number, timeoutMs?: number]
> = async (_ctx, clientIds, expectedItemCount, timeoutMs = 15000) => {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const counts = await Promise.all(
      clientIds.map(async (id) => {
        const client = clients.get(id);
        if (!client) return -1;
        try {
          return await client.page.evaluate(() => (window as any).__collection__.state.size);
        } catch {
          return -1;
        }
      })
    );

    if (counts.every((c) => c === expectedItemCount)) {
      return {
        converged: true,
        clientStates: Object.fromEntries(clientIds.map((id, i) => [id, counts[i]])),
        elapsedMs: Date.now() - startTime,
      };
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  // Return final state on timeout
  const finalCounts = await Promise.all(
    clientIds.map(async (id) => {
      const client = clients.get(id);
      if (!client) return -1;
      try {
        return await client.page.evaluate(() => (window as any).__collection__.state.size);
      } catch {
        return -1;
      }
    })
  );

  return {
    converged: false,
    clientStates: Object.fromEntries(clientIds.map((id, i) => [id, finalCounts[i]])),
    elapsedMs: Date.now() - startTime,
  };
};

/**
 * Inserts an item from all specified clients simultaneously.
 */
export const broadcastInsert: BrowserCommand<[clientIds: string[], item: any]> = async (
  _ctx,
  clientIds,
  item
) => {
  const results = { inserted: 0, failed: [] as string[] };

  await Promise.all(
    clientIds.map(async (id) => {
      try {
        const client = clients.get(id);
        if (!client) throw new Error('not found');
        await client.page.evaluate(async (item) => {
          const tx = (window as any).__collection__.insert(item);
          await tx.isPersisted.promise;
        }, item);
        results.inserted++;
      } catch {
        results.failed.push(id);
      }
    })
  );

  return results;
};

/**
 * Collects metrics from all specified clients.
 */
export const collectMetrics: BrowserCommand<
  [clientIds: string[], metricType: 'itemCount' | 'all']
> = async (_ctx, clientIds, _metricType) => {
  const metrics: Record<string, { itemCount: number } | { error: string }> = {};

  await Promise.all(
    clientIds.map(async (id) => {
      const client = clients.get(id);
      if (!client) {
        metrics[id] = { error: 'not found' };
        return;
      }
      try {
        metrics[id] = await client.page.evaluate(() => ({
          itemCount: (window as any).__collection__?.state?.size ?? 0,
        }));
      } catch (err: any) {
        metrics[id] = { error: err.message || String(err) };
      }
    })
  );

  return metrics;
};

/**
 * Waits for an item to appear in a client's collection.
 */
export const waitForItem: BrowserCommand<
  [clientId: string, itemId: string, timeoutMs?: number]
> = async (_ctx, clientId: string, itemId: string, timeoutMs = 15000) => {
  const client = clients.get(clientId);
  if (!client) throw new Error(`Client ${clientId} not found`);

  return client.page.evaluate(
    async ({ itemId, timeoutMs }) => {
      const start = Date.now();
      const collection = (window as any).__collection__;
      while (Date.now() - start < timeoutMs) {
        const items = Array.from(collection.state.values());
        const found = items.find((t: any) => t.id === itemId);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`Item ${itemId} not found after ${timeoutMs}ms`);
    },
    { itemId, timeoutMs }
  );
};

/**
 * Waits for all specified items to appear in ALL specified clients.
 * More robust than count-based convergence when dealing with shared collections.
 */
export const waitForItemsInAllClients: BrowserCommand<
  [clientIds: string[], itemIds: string[], timeoutMs?: number]
> = async (_ctx, clientIds, itemIds, timeoutMs = 30000) => {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    let allClientsHaveAllItems = true;
    const missingByClient: Record<string, string[]> = {};

    for (const clientId of clientIds) {
      const client = clients.get(clientId);
      if (!client) {
        missingByClient[clientId] = ['CLIENT_NOT_FOUND'];
        allClientsHaveAllItems = false;
        continue;
      }

      const clientItemIds = await client.page.evaluate(() => {
        const collection = (window as any).__collection__;
        const items = Array.from(collection.state.values()) as any[];
        return items.map((item) => item.id);
      });

      const missing = itemIds.filter((id) => !clientItemIds.includes(id));
      if (missing.length > 0) {
        missingByClient[clientId] = missing;
        allClientsHaveAllItems = false;
      }
    }

    if (allClientsHaveAllItems) {
      return {
        converged: true,
        elapsedMs: Date.now() - startTime,
      };
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  // Return failure with details
  const finalMissing: Record<string, string[]> = {};
  for (const clientId of clientIds) {
    const client = clients.get(clientId);
    if (!client) {
      finalMissing[clientId] = ['CLIENT_NOT_FOUND'];
      continue;
    }
    const clientItemIds = await client.page.evaluate(() => {
      const collection = (window as any).__collection__;
      const items = Array.from(collection.state.values()) as any[];
      return items.map((item) => item.id);
    });
    const missing = itemIds.filter((id) => !clientItemIds.includes(id));
    if (missing.length > 0) {
      finalMissing[clientId] = missing;
    }
  }

  return {
    converged: false,
    elapsedMs: Date.now() - startTime,
    missingByClient: finalMissing,
  };
};

/**
 * Gets all items from a client's collection.
 */
export const getItems: BrowserCommand<[clientId: string]> = async (_ctx, clientId: string) => {
  const client = clients.get(clientId);
  if (!client) throw new Error(`Client ${clientId} not found`);
  return client.page.evaluate(() => Array.from((window as any).__collection__.state.values()));
};

/**
 * Gets item count from a client's collection.
 */
export const getItemCount: BrowserCommand<[clientId: string]> = async (_ctx, clientId: string) => {
  const client = clients.get(clientId);
  if (!client) throw new Error(`Client ${clientId} not found`);
  return client.page.evaluate(() => (window as any).__collection__.state.size);
};

/**
 * Inserts an item via a client's collection.
 */
export const insertItem: BrowserCommand<[clientId: string, item: any]> = async (
  _ctx,
  clientId: string,
  item: any
) => {
  const client = clients.get(clientId);
  if (!client) throw new Error(`Client ${clientId} not found`);
  await client.page.evaluate(async (item) => {
    const tx = (window as any).__collection__.insert(item);
    await tx.isPersisted.promise;
  }, item);
};

/**
 * Updates an item via a client's collection.
 */
export const updateItem: BrowserCommand<[clientId: string, itemId: string, updates: any]> = async (
  _ctx,
  clientId: string,
  itemId: string,
  updates: any
) => {
  const client = clients.get(clientId);
  if (!client) throw new Error(`Client ${clientId} not found`);
  await client.page.evaluate(
    async ({ itemId, updates }) => {
      const tx = (window as any).__collection__.update(itemId, (draft: any) => {
        Object.assign(draft, updates);
      });
      await tx.isPersisted.promise;
    },
    { itemId, updates }
  );
};

/**
 * Deletes an item via a client's collection.
 */
export const deleteItem: BrowserCommand<[clientId: string, itemId: string]> = async (
  _ctx,
  clientId: string,
  itemId: string
) => {
  const client = clients.get(clientId);
  if (!client) throw new Error(`Client ${clientId} not found`);
  await client.page.evaluate(async (itemId) => {
    const tx = (window as any).__collection__.delete(itemId);
    await tx.isPersisted.promise;
  }, itemId);
};

/**
 * Closes a client and releases resources.
 */
export const closeClient: BrowserCommand<[clientId: string]> = async (_ctx, clientId: string) => {
  const client = clients.get(clientId);
  if (!client) return;

  try {
    await client.page.evaluate(() => {
      (window as any).__client__?.close();
    });
    await client.context.close();
  } catch {
    // Ignore errors during cleanup
  }
  clients.delete(clientId);
};

/**
 * Closes multiple clients by IDs (for cleanup of specific test clients).
 */
export const closeClients: BrowserCommand<[clientIds: string[]]> = async (_ctx, clientIds) => {
  await Promise.all(
    clientIds.map(async (clientId) => {
      const client = clients.get(clientId);
      if (!client) return;

      try {
        await client.page.evaluate(() => {
          (window as any).__client__?.close();
        });
        await client.context.close();
      } catch {
        // Ignore errors during cleanup
      }
      clients.delete(clientId);
    })
  );
};

/**
 * Closes all clients (for cleanup in afterAll/afterEach).
 */
export const closeAllClients: BrowserCommand<[]> = async () => {
  const allIds = Array.from(clients.keys());
  for (const [, client] of clients) {
    try {
      await client.page.evaluate(() => {
        (window as any).__client__?.close();
      });
      await client.context.close();
    } catch {
      // Ignore errors during cleanup
    }
  }
  clients.clear();
  return { closed: allIds.length };
};

/**
 * Debug command to dump full client state for troubleshooting.
 * Returns Yjs doc state, TanStack state, and subscription info.
 */
export const debugClient: BrowserCommand<[clientId: string]> = async (_ctx, clientId: string) => {
  const client = clients.get(clientId);
  if (!client) throw new Error(`Client ${clientId} not found`);

  return client.page.evaluate(() => {
    const collection = (window as any).__collection__;
    const convexClient = (window as any).__client__;

    // Get TanStack DB state
    const tanstackSize = collection?.state?.size ?? 0;
    const tanstackItems = collection ? Array.from(collection.state.values()) : [];

    // Get Yjs state if accessible
    let yjsInfo: any = { accessible: false };
    try {
      // Try to access internal Yjs state through collection config
      const config = (collection as any)?.config;
      if (config) {
        yjsInfo = {
          accessible: true,
          collection: config._collection,
          hasConvexClient: !!config._convexClient,
        };
      }
    } catch (e: any) {
      yjsInfo = { accessible: false, error: e.message };
    }

    // Check ConvexClient state
    let convexInfo: any = { accessible: false };
    try {
      if (convexClient) {
        convexInfo = {
          accessible: true,
          // ConvexClient doesn't expose much state publicly
          hasClient: true,
        };
      }
    } catch (e: any) {
      convexInfo = { accessible: false, error: e.message };
    }

    // Check state history from our observer
    const stateHistory = (window as any).__stateHistory__ || [];

    return {
      tanstack: {
        size: tanstackSize,
        items: tanstackItems.slice(0, 5), // First 5 items for debugging
        allItemIds: tanstackItems.map((t: any) => t.id),
      },
      yjs: yjsInfo,
      convex: convexInfo,
      isReady: (window as any).__isReady__,
      initError: (window as any).__initError__,
      stateHistory, // Show any state changes we observed
    };
  });
};

/**
 * Get console logs from a client's page.
 */
export const getConsoleLogs: BrowserCommand<[clientId: string]> = async (
  _ctx,
  clientId: string
) => {
  const client = clients.get(clientId);
  if (!client) throw new Error(`Client ${clientId} not found`);

  return client.page.evaluate(() => {
    return (window as any).__consoleLogs__ || [];
  });
};
