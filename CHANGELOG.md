# Changelog

All notable changes to ConvexReplicate will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CI/CD pipeline for automated publishing
- Apache-2.0 license for entire monorepo

### Changed
- Consolidated licensing to Apache-2.0 for patent protection
- Updated copyright holder to Trestle Inc

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

[Unreleased]: https://github.com/trestleinc/convex-replicate/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/trestleinc/convex-replicate/releases/tag/v0.1.0
