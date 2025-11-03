import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      // Main entry point
      format: 'esm',
      syntax: 'es2022',
      dts: {
        bundle: false, // Separate .d.ts files
      },
      shims: {
        esm: {
          __dirname: true,
          __filename: true,
        },
      },
      output: {
        distPath: {
          root: './dist',
        },
        externals: ['@automerge/automerge', '@automerge/automerge-repo-storage-indexeddb'],
      },
      source: {
        entry: {
          index: './src/index.ts',
        },
      },
    },
    {
      // /replication export
      format: 'esm',
      syntax: 'es2022',
      dts: {
        bundle: false,
      },
      shims: {
        esm: {
          __dirname: true,
          __filename: true,
        },
      },
      output: {
        distPath: {
          root: './dist',
        },
        externals: ['@automerge/automerge', '@automerge/automerge-repo-storage-indexeddb'],
      },
      source: {
        entry: {
          replication: './src/replication.ts',
        },
      },
    },
    {
      // /ssr export
      format: 'esm',
      syntax: 'es2022',
      dts: {
        bundle: false,
      },
      shims: {
        esm: {
          __dirname: true,
          __filename: true,
        },
      },
      output: {
        distPath: {
          root: './dist',
        },
        externals: ['@automerge/automerge', '@automerge/automerge-repo-storage-indexeddb'],
      },
      source: {
        entry: {
          ssr: './src/ssr.ts',
        },
      },
    },
  ],
  output: {
    target: 'node',
  },
});
