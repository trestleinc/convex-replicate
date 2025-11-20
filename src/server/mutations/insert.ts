import { Effect } from 'effect';
import type { GenericMutationCtx } from 'convex/server';
import { ComponentWriteError, MainTableWriteError, CRDTEncodingError } from '../errors.js';
import * as Y from 'yjs';

// ============================================================================
// Dual-Storage Insert Effect
// ============================================================================

interface InsertConfig<T> {
  readonly ctx: GenericMutationCtx<any>; // Pass Convex context explicitly
  readonly component: any;
  readonly collection: string;
  readonly documentId: string;
  readonly document: T;
  readonly version: number;
}

/**
 * Dual-storage insert operation.
 *
 * Atomicity:
 * 1. Encode document as Yjs CRDT delta
 * 2. Write delta to component (event log) - APPEND ONLY
 * 3. Write document to main table (materialized view)
 * 4. Both writes must succeed or entire operation fails
 *
 * ⚠️ CRITICAL Recovery Strategy: Dual-Storage Transaction Safety
 *
 * Convex mutations run in transactions, so either:
 * - ✅ Both component and main table writes succeed
 * - ✅ Both writes fail (transaction rolled back automatically)
 * - ❌ Partial success is IMPOSSIBLE (Convex guarantees atomicity)
 *
 * If component write succeeds but main table write fails:
 * 1. Convex automatically rolls back the entire transaction
 * 2. Component write is undone (event not persisted)
 * 3. Error is propagated to client
 * 4. Client can retry the entire operation
 *
 * ⚠️ IMPORTANT: Do NOT use Effect.retry inside the mutation
 * - Retry at client layer (TanStack DB) for determinism
 * - Convex mutations must remain deterministic
 *
 * Error handling:
 * - CRDTEncodingError: Failed to encode as Yjs delta
 * - ComponentWriteError: Event log append failed
 * - MainTableWriteError: Main table insert failed
 * - DualStorageError: Should never occur (Convex transactions prevent partial writes)
 */
export const insertDocumentEffect = <T>(config: InsertConfig<T>) =>
  Effect.gen(function* () {
    // ✅ Use ctx and component from config (passed explicitly)
    const { ctx, component } = config;

    // Step 1: Encode document as Yjs CRDT delta
    const crdtBytes = yield* Effect.try({
      try: () => {
        const ydoc = new Y.Doc();
        const ymap = ydoc.getMap(config.collection);
        ymap.set(config.documentId, config.document);
        return Y.encodeStateAsUpdateV2(ydoc);
      },
      catch: (cause) =>
        new CRDTEncodingError({
          documentId: config.documentId,
          operation: 'encode',
          cause,
        }),
    });

    // Step 2: Write to component (event log) - APPEND ONLY
    // ⚠️ NO retry/timeout here - keep mutation deterministic
    // Retry happens at client layer (TanStack DB)
    const componentResult = yield* Effect.tryPromise({
      try: () =>
        component.insertDocument({
          collection: config.collection,
          documentId: config.documentId,
          crdtBytes,
          version: config.version,
          timestamp: Date.now(),
        }),
      catch: (cause) =>
        new ComponentWriteError({
          collection: config.collection,
          documentId: config.documentId,
          operation: 'insert',
          cause,
        }),
    });

    // Step 3: Write to main table (materialized view)
    yield* Effect.try({
      try: () =>
        ctx.db.insert(config.collection, {
          ...config.document,
          _id: config.documentId,
          version: config.version,
          timestamp: Date.now(),
        }),
      catch: (cause) =>
        new MainTableWriteError({
          table: config.collection,
          documentId: config.documentId,
          operation: 'insert',
          cause,
        }),
    });

    yield* Effect.logInfo('Dual-storage insert succeeded', {
      collection: config.collection,
      documentId: config.documentId,
      version: config.version,
    });

    return componentResult;
  }).pipe(
    Effect.withSpan('dualStorage.insert', {
      attributes: {
        collection: config.collection,
        documentId: config.documentId,
      },
    })
  );
