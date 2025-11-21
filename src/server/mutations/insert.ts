import { Effect } from 'effect';
import type { GenericMutationCtx } from 'convex/server';
import { ComponentWriteError, MainTableWriteError, CRDTEncodingError } from '../errors.js';
import * as Y from 'yjs';

interface InsertConfig<T> {
  readonly ctx: GenericMutationCtx<any>;
  readonly component: any;
  readonly collection: string;
  readonly documentId: string;
  readonly document: T;
  readonly version: number;
}

export const insertDocumentEffect = <T>(config: InsertConfig<T>) =>
  Effect.gen(function* () {
    const { ctx, component } = config;
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
