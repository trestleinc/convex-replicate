import { Effect } from 'effect';
import type { GenericMutationCtx } from 'convex/server';
import {
  ComponentWriteError,
  MainTableWriteError,
  VersionConflictError,
  CRDTEncodingError,
} from '../errors.js';
import * as Y from 'yjs';

interface UpdateConfig<T> {
  readonly ctx: GenericMutationCtx<any>;
  readonly component: any;
  readonly collection: string;
  readonly documentId: string;
  readonly updates: Partial<T>;
  readonly expectedVersion: number;
}

export const updateDocumentEffect = <T>(config: UpdateConfig<T>) =>
  Effect.gen(function* () {
    const { ctx, component } = config;

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
