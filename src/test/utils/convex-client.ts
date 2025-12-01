/**
 * Real Convex Client Utilities for Integration Testing
 *
 * Provides helpers for creating real ConvexClient instances for testing.
 * Tests using these utilities will automatically skip if CONVEX_URL is not set.
 */

import { ConvexClient, ConvexHttpClient } from 'convex/browser';

// Load from .env.local or environment
const CONVEX_URL = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;

if (!CONVEX_URL) {
  // Only warn once, not on every test
  console.warn('[replicate-test] CONVEX_URL not set - real Convex tests will be skipped');
}

/**
 * Get the Convex URL if available
 */
export function getConvexUrl(): string | undefined {
  return CONVEX_URL;
}

/**
 * Check if real Convex testing is available
 */
export function isConvexAvailable(): boolean {
  return !!CONVEX_URL;
}

/**
 * Create a real ConvexClient for WebSocket-based testing
 * Returns null if CONVEX_URL is not configured
 */
export function createTestConvexClient(): ConvexClient | null {
  if (!CONVEX_URL) return null;
  return new ConvexClient(CONVEX_URL);
}

/**
 * Create a real ConvexHttpClient for HTTP-based testing
 * Returns null if CONVEX_URL is not configured
 */
export function createTestHttpClient(): ConvexHttpClient | null {
  if (!CONVEX_URL) return null;
  return new ConvexHttpClient(CONVEX_URL);
}

/**
 * Higher-order function to skip tests if Convex is not available
 * Use with vitest: it('test name', skipIfNoConvex(async () => { ... }))
 */
export function skipIfNoConvex<T extends () => void | Promise<void>>(fn: T): T | (() => void) {
  if (!CONVEX_URL) {
    return () => {
      // Empty function - test will pass but do nothing
    };
  }
  return fn;
}

/**
 * Create multiple ConvexClient instances for multi-client testing
 */
export function createTestConvexClients(count: number): ConvexClient[] {
  if (!CONVEX_URL) return [];
  return Array.from({ length: count }, () => new ConvexClient(CONVEX_URL));
}

/**
 * Close multiple ConvexClient instances
 */
export async function closeClients(clients: ConvexClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.close()));
}
