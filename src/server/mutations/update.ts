import { Effect } from 'effect';
import type { GenericMutationCtx } from 'convex/server';
import {
  ComponentWriteError,
  MainTableWriteError,
  VersionConflictError,
  CRDTEncodingError,
} from '../errors.js';
import * as Y from 'yjs';

// ============================================================================
// Dual-Storage Update Effect
// ============================================================================

interface UpdateConfig<T> {
  readonly ctx: GenericMutationCtx<any>; // Pass Convex context explicitly
  readonly component: any;
  readonly collection: string;
  readonly documentId: string;
  readonly updates: Partial<T>;
  readonly expectedVersion: number;
}

/**
 * Dual-storage update operation with optimistic concurrency control.
 *
 * Flow:
 * 1. Fetch current document from main table
 * 2. Check version (optimistic locking)
 * 3. Encode updates as Yjs CRDT delta
 * 4. Append delta to component (event log)
 * 5. Update document in main table (increment version)
 *
 * Concurrency:
 * - Uses version field for optimistic concurrency control
 * - If version mismatch, throws VersionConflictError
 * - Client must refetch and retry
 */
export const updateDocumentEffect = <T>(config: UpdateConfig<T>) =>
  Effect.gen(function* () {
    // ✅ Use ctx and component from config (passed explicitly)
    const { ctx, component } = config;

    // Step 1: Fetch current document and check version
    const current = yield* Effect.tryPromise({
      try: async () => {
        const doc = await ctx.db
          .query(config.collection)
          .filter((q) => q.eq(q.field('id'), config.documentId))
          .first();
        if (!doc) {
          throw new Error(`Document not found: ${config.documentId}`);
        }
        return doc;
      },
      catch: (error) => error as Error,
    });

    if (current.version !== config.expectedVersion) {
      yield* Effect.fail(
        new VersionConflictError({
          documentId: config.documentId,
          expectedVersion: config.expectedVersion,
          actualVersion: current.version,
        })
      );
    }

    // Step 2: Encode updates as Yjs delta
    const crdtBytes = yield* Effect.try({
      try: () => {
        const ydoc = new Y.Doc();
        const ymap = ydoc.getMap(config.collection);
        const merged = { ...current, ...config.updates };
        ymap.set(config.documentId, merged);
        return Y.encodeStateAsUpdateV2(ydoc);
      },
      catch: (cause) =>
        new CRDTEncodingError({
          documentId: config.documentId,
          operation: 'encode',
          cause,
        }),
    });

    const newVersion = config.expectedVersion + 1;

    // Step 3: Append delta to component (event log)
    yield* Effect.tryPromise({
      try: () =>
        component.updateDocument({
          collection: config.collection,
          documentId: config.documentId,
          crdtBytes,
          version: newVersion,
          timestamp: Date.now(),
        }),
      catch: (cause) =>
        new ComponentWriteError({
          collection: config.collection,
          documentId: config.documentId,
          operation: 'update',
          cause,
        }),
    });

    // Step 4: Update main table with new version
    yield* Effect.try({
      try: () =>
        ctx.db.patch(current._id, {
          ...config.updates,
          version: newVersion,
          timestamp: Date.now(),
        }),
      catch: (cause) =>
        new MainTableWriteError({
          table: config.collection,
          documentId: config.documentId,
          operation: 'update',
          cause,
        }),
    });

    yield* Effect.logInfo('Dual-storage update succeeded', {
      collection: config.collection,
      documentId: config.documentId,
      newVersion,
    });

    return { version: newVersion };
  }).pipe(
    Effect.withSpan('dualStorage.update', {
      attributes: {
        collection: config.collection,
        documentId: config.documentId,
      },
    })
  );
