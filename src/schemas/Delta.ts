import { Effect, Schema } from 'effect';
import { DeltaValidationError } from '../client/errors/index.js';

export const Delta = Schema.Struct({
  documentId: Schema.optional(Schema.String.pipe(Schema.minLength(1))),

  crdtBytes: Schema.instanceOf(Uint8Array).pipe(
    Schema.filter((bytes) => bytes.length > 0 && bytes.length < 10_000_000, {
      message: () => 'CRDT bytes must be between 1 byte and 10MB',
    })
  ),

  version: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),

  timestamp: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThan(1_600_000_000_000),
    Schema.lessThan(2_000_000_000_000)
  ),

  operationType: Schema.Literal('delta', 'snapshot', 'diff'),
});

export type Delta = Schema.Schema.Type<typeof Delta>;

export const Checkpoint = Schema.Struct({
  lastModified: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
});

export type Checkpoint = Schema.Schema.Type<typeof Checkpoint>;

export const StreamResponse = Schema.Struct({
  changes: Schema.Array(Delta),
  checkpoint: Checkpoint,
  hasMore: Schema.Boolean,
});

export type StreamResponse = Schema.Schema.Type<typeof StreamResponse>;

export const validateDelta = (delta: unknown) =>
  Schema.decodeUnknown(Delta)(delta).pipe(
    Effect.catchTag('ParseError', (error) =>
      Effect.fail(
        new DeltaValidationError({
          reason: error.message,
          documentId: (delta as any)?.documentId,
        })
      )
    )
  );

export const validateStreamResponse = (response: unknown) =>
  Schema.decodeUnknown(StreamResponse)(response).pipe(
    Effect.mapError((error) => ({
      _tag: 'StreamValidationError' as const,
      message: error.message,
    }))
  );
