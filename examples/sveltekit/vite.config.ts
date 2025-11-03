import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit(), topLevelAwait(), wasm()],
  worker: {
    format: 'es',
    plugins: () => [topLevelAwait(), wasm()],
  },
  optimizeDeps: {
    exclude: ['@automerge/automerge-wasm'],
  },
});
