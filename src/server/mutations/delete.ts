import { Effect } from 'effect';
import type { GenericMutationCtx } from 'convex/server';
import { ComponentWriteError, MainTableWriteError, CRDTEncodingError } from '../errors.js';
import * as Y from 'yjs';

// ============================================================================
// Dual-Storage Delete Effect (Hard Delete with History)
// ============================================================================

interface DeleteConfig {
  readonly ctx: GenericMutationCtx<any>; // Pass Convex context explicitly
  readonly component: any;
  readonly collection: string;
  readonly documentId: string;
}

/**
 * Dual-storage delete operation (hard delete with event history).
 *
 * Flow:
 * 1. Encode deletion as Yjs CRDT delta
 * 2. Append deletion delta to component (preserves history)
 * 3. Hard delete from main table (physical removal)
 *
 * Delete semantics (v0.3.0+):
 * - Main table: Document physically removed (no filtering needed)
 * - Component: Deletion delta appended to event log (history preserved)
 * - Queries: Standard queries work (no _deleted field checks)
 *
 * Recovery:
 * - Event log retains deletion history for audit/debugging
 * - Snapshot generation excludes deleted documents
 * - No phantom deletes due to reconciliation
 */
export const deleteDocumentEffect = (config: DeleteConfig) =>
  Effect.gen(function* () {
    // ✅ Use ctx and component from config (passed explicitly)
    const { ctx, component } = config;

    // Step 1: Encode deletion as Yjs delta
    const crdtBytes = yield* Effect.try({
      try: () => {
        const ydoc = new Y.Doc();
        const ymap = ydoc.getMap(config.collection);
        ymap.delete(config.documentId); // Yjs deletion operation
        return Y.encodeStateAsUpdateV2(ydoc);
      },
      catch: (cause) =>
        new CRDTEncodingError({
          documentId: config.documentId,
          operation: 'encode',
          cause,
        }),
    });

    // Step 2: Append deletion delta to component (PRESERVES HISTORY)
    yield* Effect.tryPromise({
      try: () =>
        component.deleteDocument({
          collection: config.collection,
          documentId: config.documentId,
          crdtBytes,
          timestamp: Date.now(),
        }),
      catch: (cause) =>
        new ComponentWriteError({
          collection: config.collection,
          documentId: config.documentId,
          operation: 'delete',
          cause,
        }),
    });

    // Step 3: Hard delete from main table (PHYSICAL REMOVAL)
    yield* Effect.try({
      try: async () => {
        const existing = await ctx.db
          .query(config.collection)
          .filter((q) => q.eq(q.field('id'), config.documentId))
          .first();

        if (existing) {
          await ctx.db.delete(existing._id);
        }
      },
      catch: (cause) =>
        new MainTableWriteError({
          table: config.collection,
          documentId: config.documentId,
          operation: 'delete',
          cause,
        }),
    });

    yield* Effect.logInfo('Dual-storage delete succeeded', {
      collection: config.collection,
      documentId: config.documentId,
    });
  }).pipe(
    Effect.withSpan('dualStorage.delete', {
      attributes: {
        collection: config.collection,
        documentId: config.documentId,
      },
    })
  );
