/**
 * Type declarations for import.meta.env
 *
 * This provides TypeScript support for environment variables accessed via import.meta.env
 * Used by both browser tests (via vitest.browser.config.ts define) and potentially Vite apps.
 */

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
  // Add other VITE_ prefixed env vars as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
