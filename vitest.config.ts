import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load test environment variables for real Convex testing
config({ path: resolve(__dirname, 'src/test/.env.local') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom', // For IndexedDB testing with fake-indexeddb
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/test/**/*.test.ts'], // All tests in test/ directory
    exclude: [
      'src/test/integration/**', // Run separately via: pnpm test:browser (requires Playwright)
      '**/node_modules/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'examples/',
        'scripts/',
        '**/*.d.ts',
        '**/*.config.*',
        'src/test/', // Exclude test files from coverage
      ],
    },
    // Benchmark configuration for performance testing
    benchmark: {
      include: ['src/test/bench/**/*.bench.ts'],
      reporters: ['default'],
    },
    typecheck: {
      enabled: false, // Disable type checking in tests for speed
    },
  },
  resolve: {
    alias: {
      $: resolve(__dirname, './src'),
    },
  },
});
