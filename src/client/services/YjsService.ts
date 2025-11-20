import { Effect, Context, Layer, Data } from 'effect';
import { IDBService } from './IDBService';
import type { IDBError, IDBWriteError } from '../errors';
import * as Y from 'yjs';

class YjsError extends Data.TaggedError('YjsError')<{
  operation: string;
  cause: unknown;
}> {}

// Service definition with lifecycle management
export class YjsService extends Context.Tag('YjsService')<
  YjsService,
  {
    readonly createDocument: (collection: string) => Effect.Effect<Y.Doc, IDBError | IDBWriteError>;
    readonly destroyDocument: (doc: Y.Doc) => Effect.Effect<void, never>;
    readonly encodeStateAsUpdate: (doc: Y.Doc) => Effect.Effect<Uint8Array, YjsError>;
    readonly applyUpdate: (
      doc: Y.Doc,
      update: Uint8Array,
      origin?: string,
      transact?: boolean
    ) => Effect.Effect<void, YjsError>;
  }
>() {}

// Service implementation
export const YjsServiceLive = Layer.effect(
  YjsService,
  Effect.gen(function* (_) {
    const idb = yield* _(IDBService);

    return YjsService.of({
      createDocument: (collection) =>
        Effect.gen(function* (_) {
          // Load or generate stable clientID (stored per collection)
          const clientIdKey = `yjsClientId:${collection}`;
          let clientId = yield* _(idb.get<number>(clientIdKey));

          if (!clientId) {
            // Generate deterministic clientID (not random for better CRDT convergence)
            clientId = Math.floor(Math.random() * 2147483647);
            yield* _(idb.set(clientIdKey, clientId));
            yield* _(
              Effect.logInfo('Generated new Yjs clientID', {
                collection,
                clientId,
              })
            );
          }

          const ydoc = new Y.Doc({
            guid: collection,
            clientID: clientId,
          } as any);
          yield* _(Effect.logInfo('Created Yjs document', { collection, clientId }));

          return ydoc;
        }),

      destroyDocument: (doc) =>
        Effect.sync(() => {
          // Critical: Free memory by destroying Y.Doc
          doc.destroy();
        }),

      encodeStateAsUpdate: (doc) =>
        Effect.try({
          try: () => Y.encodeStateAsUpdateV2(doc),
          catch: (cause) => new YjsError({ operation: 'encodeStateAsUpdate', cause }),
        }).pipe(
          Effect.timeout('2 seconds'),
          Effect.catchTag('TimeoutException', () =>
            Effect.fail(
              new YjsError({
                operation: 'encodeStateAsUpdate',
                cause: new Error('Operation timed out after 2 seconds'),
              })
            )
          )
        ),

      applyUpdate: (doc, update, origin, transact = true) =>
        Effect.try({
          try: () => {
            if (transact) {
              // Use doc.transact for proper batching and event handling
              doc.transact(() => {
                Y.applyUpdateV2(doc, update, origin);
              }, origin);
            } else {
              Y.applyUpdateV2(doc, update, origin);
            }
          },
          catch: (cause) => new YjsError({ operation: 'applyUpdate', cause }),
        }).pipe(
          Effect.timeout('2 seconds'),
          Effect.catchTag('TimeoutException', () =>
            Effect.fail(
              new YjsError({
                operation: 'applyUpdate',
                cause: new Error('Operation timed out after 2 seconds'),
              })
            )
          )
        ),
    });
  })
);

export const withYDoc = <A, E>(collection: string, f: (doc: Y.Doc) => Effect.Effect<A, E>) =>
  Effect.gen(function* (_) {
    const yjs = yield* _(YjsService);

    return yield* _(
      Effect.acquireUseRelease(yjs.createDocument(collection), f, (doc) => yjs.destroyDocument(doc))
    );
  });
