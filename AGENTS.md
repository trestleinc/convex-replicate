# AGENTS.md - Development Guide

## Commands
- **Build:** `pnpm run build` (uses Rslib, outputs to `dist/`)
- **Test:** `pnpm test` (Vitest). Run single: `pnpm test src/path/to/test.ts`
- **Lint & Format:** `pnpm run check:fix` (Biome) - **ALWAYS RUN BEFORE COMMITTING**
- **Typecheck:** `pnpm run typecheck`

## Code Style & Conventions
- **Formatting:** 2 spaces, single quotes, semicolons (enforced by Biome).
- **Imports:** Use `import type` for types. Use `node:` protocol for Node built-ins.
- **Logging:** Use `LogTape`. Avoid `console.*` (warns in Biome, allowed in tests).
- **Structure:** Single package. `src/client` (browser), `src/server` (Convex), `src/component`.
- **Documentation:** ALWAYS use `Context7` tool for library docs (Convex, Yjs, TanStack).
- **Deletion:** Hard deletes in main table; soft deletes (append-only) in component.

## Critical Rules (from CLAUDE.md)
- NEVER use WebSearch for library documentation; use Context7.
- Examples use `pnpm` and link to root via `file:../..`.
- Use `replicatedTable` helper for schemas to inject version/timestamp.
