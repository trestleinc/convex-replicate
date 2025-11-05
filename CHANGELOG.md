# Changelog

All notable changes to ConvexReplicate will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Soft delete pattern:** Simplified delete operations to use `collection.update()` with `deleted: true` field instead of `collection.delete()`
- Removed `onDelete` handler (~80 lines of complex logic)
- Removed `deletedKeys` tracking and cleanup code
- Subscription handler now treats `deleted` as a regular field like `isCompleted`
- UI filters out soft-deleted items for display
- Server returns all items (including deleted) for proper Yjs CRDT synchronization

### Fixed
- Delete operations now work correctly across multiple clients without flicker
- Yjs CRDT state remains consistent during delete operations
- Subscription handler now syncs data to Yjs BEFORE TanStack DB for proper CRDT flow
- SSR initialData now syncs to Yjs for consistent CRDT state

### Removed
- `deleteDocument` mutation (use `updateDocument` with `deleted: true` instead)
- `deleteDocumentHelper` function (use `updateDocumentHelper` with `deleted: true` instead)
- `onDelete` collection handler (uses `onUpdate` now)

### Performance
- 89 lines of complex delete handling code removed
- Simpler architecture reduces cognitive overhead
- Delete operations work exactly like field updates (no special cases)

## [0.3.0] - 2025-11-04

### Breaking Changes

**Complete architectural rewrite:** Migrated from Automerge to Yjs with TanStack offline-transactions integration.

#### CRDT Library Migration
- **REMOVED:** Automerge CRDT library (~150KB + WASM)
- **ADDED:** Yjs CRDT library (~6KB, no WASM, 96% smaller)
- **BENEFIT:** React Native compatible, faster load times, simpler bundler configuration

#### API Changes
- **BREAKING:** Collection creation now requires two steps:
  1. `createCollection(convexCollectionOptions(...))` - Create raw TanStack DB collection
  2. `createConvexCollection(rawCollection)` - Wrap with offline support
- **NEW:** `createConvexCollection()` function to wrap collections with Yjs + TanStack offline support
- **REMOVED:** `AutomergeDocumentStore` class (replaced by Yjs + TanStack infrastructure)
- **REMOVED:** `SyncAdapter` class (replaced by TanStack offline executor)

#### Dependencies
- **REMOVED:** `@automerge/automerge` and `@automerge/automerge-repo-storage-indexeddb` peer dependencies
- **ADDED:** `yjs ^13.6.11` peer dependency
- **ADDED:** `@tanstack/offline-transactions ^0.1.0` peer dependency
- **REMOVED:** `vite-plugin-wasm` and `vite-plugin-top-level-await` (no longer needed)

#### Schema Changes
- **REMOVED:** `deleted` field no longer required (proper hard deletes now work correctly)
- **NOTE:** Existing apps can keep `deleted` field for backwards compatibility

### Fixed
- Critical sync bug where invalid 'upsert' operation caused UI update failures
- Replaced invalid 'upsert' with proper insert/update logic in changeStream subscription
- Improved conflict resolution reliability with Yjs CRDT engine

### Changed
- Integrated TanStack offline-transactions for outbox pattern and retry logic
- Improved multi-tab sync coordination using TanStack's built-in BroadcastChannel support
- Simplified Vite configuration (no WASM plugins needed)
- Updated both example apps (tanstack-start and sveltekit) to use new architecture

### Performance
- 96% reduction in CRDT library size (Automerge ~150KB → Yjs ~6KB)
- Eliminated WASM initialization overhead
- Faster initial page load
- More efficient memory usage

### Migration
- See [MIGRATION-0.3.0.md](./MIGRATION-0.3.0.md) for complete migration guide
- Server-side API remains backwards compatible (no changes to Convex functions)
- Component installation unchanged

## [0.2.2] - 2025-11-01

### Added
- SvelteKit example application with Svelte 5 runes
- Support for TanStack Svelte DB v0.4.16

### Changed
- Updated TanStack DB to v0.4.16 for improved stability

## [0.2.1] - 2025-10-28

### Changed
- Migrated core package to Rslib (Rspack-based bundler)
- Externalized Automerge as peer dependency (57% package size reduction)
- Package size reduced from ~150KB to ~65KB

### Added
- Peer dependencies: `@automerge/automerge ^3.1.2` and `@automerge/automerge-repo-storage-indexeddb ^2.4.0`
- Automatic peer dependency installation with Bun

### Documentation
- See [MIGRATION-0.2.1.md](./MIGRATION-0.2.1.md) for peer dependency migration guide

## [0.2.0] - 2025-10-25

### Breaking Changes
- Renamed all public APIs for consistency (removed redundant "Replicate" and "Automerge" suffixes)
- Package names changed to `@trestleinc` scope

#### API Renames
- `convexAutomergeCollectionOptions` → `convexCollectionOptions`
- `ConvexReplicateCollection` → `ConvexCollection`
- `getConvexReplicateLogger` → `getLogger`
- `ConvexReplicateStorage` → `ReplicateStorage`

### Documentation
- See [MIGRATION-0.2.0.md](./MIGRATION-0.2.0.md) for complete migration guide

## [0.1.0] - 2025-11-01

### Fixed
- Server-side WASM bundling error (import from /replication)
- Client-side CRDT bytes handling for proper conflict resolution

### Changed
- Updated API to use explicit `crdtBytes` instead of materialized documents
- Split submitDocument into insertDocument/updateDocument/deleteDocument

### Added
- Initial release of @convex-replicate/component
- Initial release of @convex-replicate/core
- Dual-storage pattern with CRDT layer
- TanStack DB integration
- SSR support
- Automerge CRDT conflict resolution
- Framework-agnostic replication helpers
- IndexedDB persistence for offline-first functionality

[Unreleased]: https://github.com/trestleinc/convex-replicate/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/trestleinc/convex-replicate/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/trestleinc/convex-replicate/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/trestleinc/convex-replicate/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/trestleinc/convex-replicate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/trestleinc/convex-replicate/releases/tag/v0.1.0
