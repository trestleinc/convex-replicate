/**
 * Client Pool Utilities
 * Manages multiple Convex clients for stress testing
 */

import type { ConvexClient } from 'convex/browser';

export interface ClientPoolOptions {
  /** Convex deployment URL */
  convexUrl: string;
  /** Maximum number of clients to create */
  maxClients?: number;
  /** Factory function to create ConvexClient instances */
  clientFactory?: (url: string) => ConvexClient;
}

/**
 * Manages a pool of Convex clients for multi-client stress testing
 */
export class ClientPool {
  private clients: Map<string, ConvexClient> = new Map();
  private convexUrl: string;
  private maxClients: number;
  private clientFactory: (url: string) => ConvexClient;

  constructor(options: ClientPoolOptions) {
    this.convexUrl = options.convexUrl;
    this.maxClients = options.maxClients ?? 50;

    // Default factory - will need to be provided for actual usage
    this.clientFactory =
      options.clientFactory ??
      (() => {
        throw new Error('clientFactory must be provided to create real ConvexClient instances');
      });
  }

  /**
   * Create a single client with a given ID
   */
  async createClient(id: string): Promise<ConvexClient> {
    if (this.clients.size >= this.maxClients) {
      throw new Error(`Maximum client limit (${this.maxClients}) reached`);
    }

    if (this.clients.has(id)) {
      throw new Error(`Client with id "${id}" already exists`);
    }

    const client = this.clientFactory(this.convexUrl);
    this.clients.set(id, client);
    return client;
  }

  /**
   * Create multiple clients with auto-generated IDs
   */
  async createClients(count: number): Promise<ConvexClient[]> {
    const clients: ConvexClient[] = [];

    for (let i = 0; i < count; i++) {
      const id = `client-${i}`;
      const client = await this.createClient(id);
      clients.push(client);
    }

    return clients;
  }

  /**
   * Get a client by ID
   */
  getClient(id: string): ConvexClient | undefined {
    return this.clients.get(id);
  }

  /**
   * Get all clients
   */
  getAllClients(): ConvexClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get client count
   */
  size(): number {
    return this.clients.size;
  }

  /**
   * Close a specific client
   */
  async closeClient(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.close();
      this.clients.delete(id);
    }
  }

  /**
   * Close all clients
   */
  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.clients.entries()).map(async ([id, client]) => {
      await client.close();
      this.clients.delete(id);
    });

    await Promise.all(closePromises);
  }

  /**
   * Run an operation across all clients in parallel
   */
  async runParallel<T>(
    fn: (client: ConvexClient, index: number, id: string) => Promise<T>
  ): Promise<T[]> {
    const entries = Array.from(this.clients.entries());
    const results = await Promise.all(entries.map(([id, client], index) => fn(client, index, id)));
    return results;
  }

  /**
   * Run an operation across all clients sequentially
   */
  async runSequential<T>(
    fn: (client: ConvexClient, index: number, id: string) => Promise<T>
  ): Promise<T[]> {
    const results: T[] = [];
    const entries = Array.from(this.clients.entries());

    for (let i = 0; i < entries.length; i++) {
      const [id, client] = entries[i];
      results.push(await fn(client, i, id));
    }

    return results;
  }

  /**
   * Wait for all clients to converge on expected document count
   * Uses polling to check each client's query result
   */
  async waitForConvergence(
    queryFn: (client: ConvexClient) => Promise<number>,
    expectedCount: number,
    timeoutMs: number = 10000,
    pollIntervalMs: number = 100
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const counts = await this.runParallel(async (client) => queryFn(client));

      // Check if all clients have the expected count
      if (counts.every((count) => count === expectedCount)) {
        return true;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return false;
  }

  /**
   * Check if all clients have converged (same state)
   */
  async checkConvergence(queryFn: (client: ConvexClient) => Promise<unknown>): Promise<boolean> {
    const results = await this.runParallel(async (client) => queryFn(client));

    if (results.length === 0) return true;

    const firstResult = JSON.stringify(results[0]);
    return results.every((result) => JSON.stringify(result) === firstResult);
  }
}

/**
 * Create a client pool with default options
 */
export function createClientPool(
  convexUrl: string,
  clientFactory: (url: string) => ConvexClient
): ClientPool {
  return new ClientPool({
    convexUrl,
    clientFactory,
  });
}
