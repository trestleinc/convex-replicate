# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-12-01

First stable release of Convex Replicate.

### Added

- Effect.js service architecture for dependency injection and composable services
- Comprehensive test suite with 180+ tests (unit, integration, benchmarks)
- JSDoc documentation for all exported functions
- Undo/redo and client-side history utilities
- Version history and maintenance features
- Improved type safety across client code with proper TypeScript interfaces
- Checkpoint service for managing sync checkpoints in IndexedDB
- Protocol version negotiation for handling package updates
- Snapshot recovery service for handling compaction scenarios
- Reconciliation service for phantom document cleanup

### Changed

- Refactored terminology: "sync" renamed to "replicate" throughout codebase
- Simplified architecture with cleaner Effect-based service layer
- Improved type definitions (removed `any` types in favor of proper generics)
- Streamlined Yjs update application (removed unnecessary transaction wrapper)

### Removed

- SvelteKit example (TanStack Start example remains as reference)
- Dead code and unused imports
- Outdated monorepo-style release configuration
