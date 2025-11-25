import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom', // For IndexedDB testing with fake-indexeddb
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/test/**/*.test.ts'], // All tests in test/ directory
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
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
