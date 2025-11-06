# ConvexReplicate Roadmap

This document outlines planned features and improvements for ConvexReplicate.

## v0.3.0 (Current - In Development)

**Status:** Implementation complete, testing in progress

### Implemented

- Delta event sourcing with append-only CRDT log
- Hard delete support with history preservation
- `onDelete` handler for TanStack DB integration
- Subscription-based hard delete detection
- `getDocumentHistory` query for accessing event history
- Dual storage architecture (CRDT component + main tables)

### In Progress

- Documentation updates
- Example app refinements
- Integration testing

## v0.4.0 (Planned)

**Focus:** Recovery and Audit Features

### Document Recovery

- Client-side restore function for deleted documents
- Point-in-time document reconstruction from deltas
- Conflict resolution for concurrent delete/restore operations
- TypeScript utilities for working with document history

**API:**
```typescript
// Restore a deleted document
await collection.restore(documentId, options?: {
  timestamp?: number;  // Restore to specific point in time
  version?: number;    // Restore to specific version
});

// Get document history for UI
const history = await collection.getHistory(documentId);
// Returns: Array<{ version, timestamp, operationType, changes }>
```

### Audit Trail Features

- Query interface for document history
- Export document history to JSON/CSV
- History filtering and search
- Change attribution (if user tracking added)

**API:**
```typescript
// Query history for a collection
const auditLog = await collection.queryHistory({
  startTime: Date.now() - 86400000,  // Last 24 hours
  endTime: Date.now(),
  operationType: 'delete',           // Filter by operation type
  limit: 100,
});
```

## v0.5.0 (Planned)

**Focus:** Advanced Sync Features

### Features

- Partial collection sync (sync subset of documents based on filters)
- Delta compression (reduce bandwidth for large documents)
- Batch operations (bulk insert/update/delete with single round-trip)
- Optimistic deletion (delete locally, queue for server)

### Performance

- Pagination for large collections
- Incremental sync improvements
- Memory optimization for large histories
- Background sync workers

## v1.0.0 (Future)

**Focus:** Production Hardening

### Security

- Encryption at rest for CRDT bytes
- Field-level encryption support
- Audit log immutability guarantees

### Advanced Features

- Multi-collection transactions
- Schema migrations with history preservation
- Time-travel queries (query collection at any past timestamp)
- Advanced conflict resolution strategies

### Developer Experience

- CLI tools for inspecting CRDT storage
- Admin dashboard for monitoring replication
- Metrics and observability hooks
- Better TypeScript inference

## Beyond v1.0

### Possible Features (Backlog)

- Attachment support (files, images, blobs)
- Rich text collaboration (Yjs text types)
- Shared cursors and presence
- Vue.js wrapper
- Angular wrapper
- Advanced Yjs features (collaborative editing)
- GraphQL subscriptions
- Webhook support for external integrations

## Feature Requests

Have an idea? Open an issue on GitHub with the label `feature-request`.

## Contributing

Want to help implement these features? See CONTRIBUTING.md for guidelines.

## Notes

- All features are subject to change based on user feedback
- Release dates are estimates and may shift
- Breaking changes will follow semantic versioning
- Community contributions are welcome for any roadmap item
