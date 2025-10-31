import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [tailwindcss(), react(), topLevelAwait(), wasm()],
  resolve: {
    conditions: ['@convex-dev/component-source'],
  },
  worker: {
    format: 'es',
    plugins: () => [topLevelAwait(), wasm()],
  },
  optimizeDeps: {
    exclude: ['@automerge/automerge-wasm'],
  },
});
