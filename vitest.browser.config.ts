import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { playwright } from '@vitest/browser-playwright';
import {
  createClient,
  createClients,
  waitForItem,
  waitForItemsInAllClients,
  waitForConvergence,
  getItems,
  getItemCount,
  insertItem,
  updateItem,
  deleteItem,
  broadcastInsert,
  collectMetrics,
  closeClient,
  closeClients,
  closeAllClients,
  debugClient,
} from './src/test/commands/multi-client';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load test environment variables for real Convex testing
config({ path: resolve(__dirname, 'src/test/.env.local') });

export default defineConfig({
  // Expose CONVEX_URL to browser via import.meta.env.VITE_CONVEX_URL
  define: {
    'import.meta.env.VITE_CONVEX_URL': JSON.stringify(process.env.CONVEX_URL),
  },
  test: {
    browser: {
      provider: playwright(),
      enabled: true,
      headless: true,
      instances: [{ browser: 'chromium' }],
      commands: {
        createClient,
        createClients,
        waitForItem,
        waitForItemsInAllClients,
        waitForConvergence,
        getItems,
        getItemCount,
        insertItem,
        updateItem,
        deleteItem,
        broadcastInsert,
        collectMetrics,
        closeClient,
        closeClients,
        closeAllClients,
        debugClient,
      },
    },
    // Only include browser/integration tests
    include: ['src/test/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    // Longer timeout for real network operations
    testTimeout: 30000,
    hookTimeout: 30000,
    // Test reporters for CI and local development
    reporters: ['default', 'html', 'json'],
    outputFile: {
      html: './test-results/browser/index.html',
      json: './test-results/browser/results.json',
    },
  },
  resolve: {
    alias: {
      $: resolve(__dirname, './src'),
    },
  },
});
