import { Schema } from '@effect/schema';
import { Effect } from 'effect';
import { DeltaValidationError } from '../client/errors/index.js';

// ============================================================================
// CRDT Delta Schema with Validation
// ============================================================================

export const CRDTDelta = Schema.Struct({
  documentId: Schema.optional(Schema.String.pipe(Schema.minLength(1))),

  crdtBytes: Schema.instanceOf(Uint8Array).pipe(
    Schema.filter(
      (bytes) => bytes.length > 0 && bytes.length < 10_000_000, // 10MB limit
      {
        message: () => 'CRDT bytes must be between 1 byte and 10MB',
      }
    )
  ),

  version: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),

  timestamp: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThan(1_600_000_000_000), // After 2020
    Schema.lessThan(2_000_000_000_000) // Before 2033
  ),

  operationType: Schema.Literal('delta', 'snapshot', 'diff'),
});

export type CRDTDelta = Schema.Schema.Type<typeof CRDTDelta>;

// ============================================================================
// Stream Response Schema
// ============================================================================

export const Checkpoint = Schema.Struct({
  lastModified: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
});

export type Checkpoint = Schema.Schema.Type<typeof Checkpoint>;

export const StreamResponse = Schema.Struct({
  changes: Schema.Array(CRDTDelta),
  checkpoint: Checkpoint,
  hasMore: Schema.Boolean,
});

export type StreamResponse = Schema.Schema.Type<typeof StreamResponse>;

// ============================================================================
// Validation Helpers
// ============================================================================

export const validateDelta = (delta: unknown) =>
  Schema.decodeUnknown(CRDTDelta)(delta).pipe(
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
