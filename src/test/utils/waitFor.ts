/**
 * Wait for a condition to be true with polling
 * Similar to Vitest's vi.waitFor but with more control
 */

export async function waitFor<T>(
  fn: () => T | Promise<T>,
  options: {
    timeout?: number;
    interval?: number;
    errorMessage?: string;
  } = {}
): Promise<T> {
  const { timeout = 1000, interval = 50, errorMessage = 'waitFor timed out' } = options;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (_error) {
      // Continue waiting
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`${errorMessage} after ${timeout}ms`);
}
