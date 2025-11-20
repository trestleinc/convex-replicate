import { Effect, Context, Layer } from 'effect';
import { YjsService } from './YjsService';
import { ReconciliationError as ReconciliationErrorImport } from '../errors';

// Service definition
export class ReconciliationService extends Context.Tag('ReconciliationService')<
  ReconciliationService,
  {
    readonly reconcileWithMainTable: <T>(
      collection: string,
      serverDocs: readonly T[],
      getKey: (doc: T) => string,
      deleteFromTanStack: (keys: string[]) => Effect.Effect<void, never>
    ) => Effect.Effect<void, ReconciliationErrorImport>;
  }
>() {}

// Service implementation
export const ReconciliationServiceLive = Layer.effect(
  ReconciliationService,
  Effect.gen(function* (_) {
    const yjs = yield* _(YjsService);

    return ReconciliationService.of({
      reconcileWithMainTable: (collection, serverDocs, getKey, deleteFromTanStack) =>
        Effect.gen(function* (_) {
          yield* _(Effect.logInfo('Starting reconciliation', { collection }));

          const ydoc = yield* _(yjs.createDocument(collection));
          const serverDocIds = new Set(serverDocs.map(getKey));
          const ymap = ydoc.getMap(collection);
          const toDelete: string[] = [];

          // Find phantom documents (in Yjs but not on server)
          ymap.forEach((_, key) => {
            if (!serverDocIds.has(key)) {
              toDelete.push(key);
            }
          });

          if (toDelete.length > 0) {
            yield* _(
              Effect.logWarning(`Found ${toDelete.length} phantom documents`, {
                collection,
                phantomDocs: toDelete.slice(0, 10), // Log first 10
              })
            );

            // Remove from Yjs
            yield* _(
              Effect.sync(() => {
                ydoc.transact(() => {
                  for (const key of toDelete) {
                    ymap.delete(key);
                  }
                }, 'reconciliation');
              })
            );

            // Sync deletes to TanStack DB
            yield* _(deleteFromTanStack(toDelete));

            yield* _(
              Effect.logInfo('Reconciliation completed', {
                collection,
                deletedCount: toDelete.length,
              })
            );
          } else {
            yield* _(Effect.logDebug('No phantom documents found', { collection }));
          }
        }).pipe(
          Effect.catchAll((cause) =>
            Effect.fail(
              new ReconciliationErrorImport({
                collection,
                reason: 'Reconciliation failed',
                cause,
              })
            )
          )
        ),
    });
  })
);
