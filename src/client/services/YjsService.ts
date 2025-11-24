import { Effect, Context, Layer, Data } from 'effect';
import { IDBService } from './IDBService';
import type { IDBError, IDBWriteError } from '../errors';
import * as Y from 'yjs';

export class YjsError extends Data.TaggedError('YjsError')<{
  operation: string;
  cause: unknown;
}> {}

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
    readonly getMap: <T = unknown>(doc: Y.Doc, name: string) => Effect.Effect<Y.Map<T>, never>;
    readonly transact: <A>(doc: Y.Doc, fn: () => A, origin?: string) => Effect.Effect<A, never>;
    readonly observeUpdates: (
      doc: Y.Doc,
      handler: (update: Uint8Array, origin: any) => void
    ) => Effect.Effect<() => void, never>;
  }
>() {}

export const YjsServiceLive = Layer.effect(
  YjsService,
  Effect.gen(function* (_) {
    const idb = yield* _(IDBService);

    return YjsService.of({
      createDocument: (collection) =>
        Effect.gen(function* (_) {
          const clientIdKey = `yjsClientId:${collection}`;
          let clientId = yield* _(idb.get<number>(clientIdKey));

          if (!clientId) {
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

      getMap: (doc, name) =>
        Effect.sync(() => {
          return doc.getMap(name);
        }),

      transact: (doc, fn, origin) =>
        Effect.sync(() => {
          return doc.transact(fn, origin);
        }),

      observeUpdates: (doc, handler) =>
        Effect.sync(() => {
          const wrappedHandler = (update: Uint8Array, origin: any) => {
            handler(update, origin);
          };
          (doc as any).on('updateV2', wrappedHandler);

          // Return cleanup function
          return () => {
            (doc as any).off('updateV2', wrappedHandler);
          };
        }),
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
