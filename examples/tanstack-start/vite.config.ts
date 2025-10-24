import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import viteTsConfigPaths from 'vite-tsconfig-paths';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

const config = defineConfig({
  plugins: [
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    topLevelAwait(),
    wasm(),
  ],
  worker: {
    format: 'es',
    plugins: () => [topLevelAwait(), wasm()],
  },
  optimizeDeps: {
    exclude: ['@automerge/automerge-wasm'],
  },
});

export default config;
