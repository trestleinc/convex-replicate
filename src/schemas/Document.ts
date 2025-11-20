import { Schema } from '@effect/schema';
import { Effect } from 'effect';

// ============================================================================
// Component Document Schema (Event Log)
// ============================================================================

export const ComponentDocument = Schema.Struct({
  collection: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(64),
    Schema.pattern(/^[a-zA-Z][a-zA-Z0-9_]*$/),
    Schema.annotations({
      description: 'Valid Convex table name',
    })
  ),

  documentId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),

  crdtBytes: Schema.instanceOf(ArrayBuffer).pipe(
    Schema.filter((buf) => buf.byteLength > 0 && buf.byteLength < 10_000_000, {
      message: () => 'CRDT bytes must be between 1 byte and 10MB',
    }),
    Schema.filter((buf) => validateYjsUpdateHeader(buf), {
      message: () => 'Invalid Yjs update format',
    })
  ),

  version: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),

  timestamp: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThan(1_600_000_000_000),
    Schema.lessThan(2_000_000_000_000)
  ),
});

export type ComponentDocument = Schema.Schema.Type<typeof ComponentDocument>;

// ============================================================================
// Yjs Update Header Validation
// ============================================================================

const validateYjsUpdateHeader = (buffer: ArrayBuffer): boolean => {
  try {
    const view = new DataView(buffer);
    // Yjs updates start with specific byte patterns
    // First byte should be 0x00 (for struct updates) or 0x01 (for delete sets)
    const firstByte = view.getUint8(0);
    return firstByte === 0x00 || firstByte === 0x01 || firstByte === 0x02;
  } catch {
    return false;
  }
};

// ============================================================================
// Validation Effect
// ============================================================================

export const validateComponentDocument = (doc: unknown) =>
  Schema.decodeUnknown(ComponentDocument)(doc).pipe(
    Effect.mapError((error) => ({
      _tag: 'DocumentValidationError' as const,
      message: error.message,
      issue: error.issue,
    }))
  );
