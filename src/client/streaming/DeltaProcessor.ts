import { Effect, Stream, Schedule, Option, Queue } from 'effect';
import type { ConvexClient } from 'convex/browser';
import {
  type CRDTDelta,
  type Checkpoint,
  validateDelta,
  validateStreamResponse,
} from '../../schemas/CRDTDelta.js';
import { YjsApplicationError, SubscriptionError } from '../errors/index.js';
import * as Y from 'yjs';

// ============================================================================
// Streaming Configuration
// ============================================================================

export const STREAMING_CONFIG = {
  // Backpressure
  bufferCapacity: 1000, // Max deltas in buffer before dropping/blocking
  bufferStrategy: 'dropping' as const, // "dropping" | "sliding" | "suspending"

  // Rate limiting
  maxDeltasPerSecond: 100, // Default: 100 deltas/sec

  // Concurrency
  deltaConcurrency: 'unbounded' as const, // Yjs is single-threaded, safe to process in order

  // Error recovery
  maxConsecutiveErrors: 10, // Trigger gap detection after 10 consecutive errors
  errorRetryDelay: 1000, // Wait 1s before retrying failed delta

  // Adaptive tuning (based on device)
  mobileMaxDeltasPerSecond: 50, // Slower devices
  lowEndMaxDeltasPerSecond: 20, // Very low-end devices
} as const;

export type BufferStrategy = 'dropping' | 'sliding' | 'suspending';

// ============================================================================
// Device Capability Detection
// ============================================================================

const detectDeviceCapability = (): 'desktop' | 'mobile' | 'low-end' => {
  // SSR-safe check
  if (typeof navigator === 'undefined') return 'desktop';

  // Check if mobile
  const isMobile = /Mobile|Android|iPhone|iPad|iPod/.test(navigator.userAgent);

  // Check hardware concurrency (CPU cores)
  const cores = navigator.hardwareConcurrency || 2;

  // Check if low-end device
  const isLowEnd = cores <= 2;

  if (isLowEnd) return 'low-end';
  if (isMobile) return 'mobile';
  return 'desktop';
};

const getAdaptiveRateLimit = (): number => {
  const capability = detectDeviceCapability();

  switch (capability) {
    case 'low-end':
      return STREAMING_CONFIG.lowEndMaxDeltasPerSecond;
    case 'mobile':
      return STREAMING_CONFIG.mobileMaxDeltasPerSecond;
    case 'desktop':
      return STREAMING_CONFIG.maxDeltasPerSecond;
  }
};

// ============================================================================
// Yjs Delta Application
// ============================================================================

export const applyYjsDelta = (ydoc: Y.Doc, change: CRDTDelta) =>
  Effect.try({
    try: () => {
      const origin = change.operationType === 'snapshot' ? 'snapshot' : 'subscription';

      Y.applyUpdateV2(ydoc, change.crdtBytes, origin);
    },
    catch: (cause) =>
      new YjsApplicationError({
        documentId: change.documentId ?? 'unknown',
        deltaSize: change.crdtBytes.length,
        cause,
      }),
  }).pipe(
    Effect.timeout('2 seconds'),
    Effect.retry(Schedule.recurs(3)),
    Effect.withSpan('yjs.applyDelta', {
      attributes: {
        documentId: change.documentId,
        operationType: change.operationType,
        deltaSize: change.crdtBytes.length,
      },
    })
  );

// ============================================================================
// Paginated CRDT Stream
// ============================================================================

export interface StreamConfig {
  readonly convexClient: ConvexClient;
  readonly api: { stream: any };
  readonly initialCheckpoint: Checkpoint;
  readonly pageSize: number;
}

export const streamCRDTDeltas = (config: StreamConfig) =>
  Stream.paginateEffect(config.initialCheckpoint, (checkpoint) =>
    Effect.gen(function* () {
      // Query next page with timeout and retry
      const rawResponse = yield* Effect.tryPromise({
        try: () =>
          config.convexClient.query(config.api.stream, {
            checkpoint,
            limit: config.pageSize,
          }),
        catch: (cause) =>
          new SubscriptionError({
            collection: 'unknown',
            checkpoint,
            cause,
          }),
      }).pipe(
        Effect.timeout('10 seconds'),
        Effect.retry({
          schedule: Schedule.exponential('1 second').pipe(Schedule.intersect(Schedule.recurs(5))),
        })
      );

      // Validate response schema
      const response = yield* validateStreamResponse(rawResponse);

      // Return deltas + next checkpoint (or None if done)
      return [
        response.changes,
        response.hasMore ? Option.some(response.checkpoint) : Option.none(),
      ] as const;
    })
  ).pipe(Stream.flatMap((deltas) => Stream.fromIterable(deltas)));

// ============================================================================
// Process CRDT Stream with Rate Limiting
// ============================================================================

export interface ProcessConfig extends StreamConfig {
  readonly ydoc: Y.Doc;
  readonly syncToTanStack: (change: CRDTDelta, ydoc: Y.Doc) => Effect.Effect<void>;
  readonly maxDeltasPerSecond?: number;
}

export const processCRDTStream = (config: ProcessConfig) =>
  streamCRDTDeltas(config).pipe(
    // Rate limit: prevent Yjs GC pressure
    Stream.throttle({
      cost: () => 1, // Each delta costs 1 unit
      duration: `${1000 / (config.maxDeltasPerSecond ?? getAdaptiveRateLimit())} millis`,
      units: config.maxDeltasPerSecond ?? getAdaptiveRateLimit(),
      burst: 10,
    }),

    // Validate each delta
    Stream.mapEffect((delta) =>
      Effect.gen(function* () {
        // Schema validation
        const validDelta = yield* validateDelta(delta);

        // Apply to Yjs
        yield* applyYjsDelta(config.ydoc, validDelta);

        // Sync to TanStack DB
        yield* config.syncToTanStack(validDelta, config.ydoc);

        return validDelta.timestamp;
      }).pipe(
        Effect.timeout('5 seconds'),
        Effect.retry({
          schedule: Schedule.exponential('100 millis').pipe(Schedule.intersect(Schedule.recurs(3))),
        }),
        Effect.catchAll((error) =>
          // Log error but don't fail stream (fault-tolerant)
          Effect.logError('Delta processing failed (continuing)', {
            error,
            documentId: delta.documentId,
          }).pipe(Effect.as(0))
        )
      )
    ),

    // Accumulate latest timestamp for checkpointing
    Stream.runFold(0, (latestTimestamp, currentTimestamp) =>
      Math.max(latestTimestamp, currentTimestamp)
    )
  );

// ============================================================================
// Backpressure Utilities
// ============================================================================

export const createBufferedStream = <T>(capacity: number, strategy: BufferStrategy) =>
  Effect.gen(function* () {
    let queue: Queue.Queue<T>;

    switch (strategy) {
      case 'dropping':
        // Drop oldest items when full
        queue = yield* Queue.dropping<T>(capacity);
        break;

      case 'sliding':
        // Drop newest items when full
        queue = yield* Queue.sliding<T>(capacity);
        break;

      case 'suspending':
        // Block producer when full (backpressure)
        queue = yield* Queue.bounded<T>(capacity);
        break;
    }

    return queue;
  });

// ============================================================================
// Adaptive Rate Limiting
// ============================================================================

export const applyRateLimit = (stream: Stream.Stream<CRDTDelta>, maxPerSecond: number) =>
  stream.pipe(
    // Throttle: Allow max N items per second
    Stream.throttle({
      cost: () => 1, // Each delta costs 1 unit
      units: maxPerSecond, // Max units per duration
      duration: '1 second', // Time window
    })
  );

export const createAdaptiveRateLimitedStream = (source: Stream.Stream<CRDTDelta>) =>
  Effect.gen(function* () {
    const rateLimit = getAdaptiveRateLimit();

    yield* Effect.logInfo('Applying adaptive rate limit', {
      device: detectDeviceCapability(),
      maxDeltasPerSecond: rateLimit,
    });

    return applyRateLimit(source, rateLimit);
  });
