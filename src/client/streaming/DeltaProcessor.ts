import { Effect, Stream, Schedule, Option, Queue } from 'effect';
import type { ConvexClient } from 'convex/browser';
import {
  type Delta,
  type Checkpoint,
  validateDelta,
  validateStreamResponse,
} from '../../schemas/Delta.js';
import { YjsApplicationError, SubscriptionError } from '../errors/index.js';
import * as Y from 'yjs';

export const STREAMING_CONFIG = {
  bufferCapacity: 1000,
  bufferStrategy: 'dropping' as const,
  maxDeltasPerSecond: 100,
  deltaConcurrency: 'unbounded' as const,
  maxConsecutiveErrors: 10,
  errorRetryDelay: 1000,

  mobileMaxDeltasPerSecond: 50,
  lowEndMaxDeltasPerSecond: 20,
} as const;

export type BufferStrategy = 'dropping' | 'sliding' | 'suspending';

const detectDeviceCapability = (): 'desktop' | 'mobile' | 'low-end' => {
  if (typeof navigator === 'undefined') return 'desktop';

  const isMobile = /Mobile|Android|iPhone|iPad|iPod/.test(navigator.userAgent);

  const cores = navigator.hardwareConcurrency || 2;

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

export const applyYjsDelta = (ydoc: Y.Doc, change: Delta) =>
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

export interface StreamConfig {
  readonly convexClient: ConvexClient;
  readonly api: { stream: any };
  readonly origin: Checkpoint;
  readonly pageSize: number;
}

export const streamDeltas = (config: StreamConfig) =>
  Stream.paginateEffect(config.origin, (checkpoint) =>
    Effect.gen(function* () {
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

      const response = yield* validateStreamResponse(rawResponse);

      return [
        response.changes,
        response.hasMore ? Option.some(response.checkpoint) : Option.none(),
      ] as const;
    })
  ).pipe(Stream.flatMap((deltas) => Stream.fromIterable(deltas)));

export interface ProcessConfig extends StreamConfig {
  readonly ydoc: Y.Doc;
  readonly syncToTanStack: (change: Delta, ydoc: Y.Doc) => Effect.Effect<void>;
  readonly maxDeltasPerSecond?: number;
}

export const processCRDTStream = (config: ProcessConfig) =>
  streamDeltas(config).pipe(
    Stream.throttle({
      cost: () => 1,
      duration: `${1000 / (config.maxDeltasPerSecond ?? getAdaptiveRateLimit())} millis`,
      units: config.maxDeltasPerSecond ?? getAdaptiveRateLimit(),
      burst: 10,
    }),

    Stream.mapEffect((delta) =>
      Effect.gen(function* () {
        const validDelta = yield* validateDelta(delta);

        yield* applyYjsDelta(config.ydoc, validDelta);

        yield* config.syncToTanStack(validDelta, config.ydoc);

        return validDelta.timestamp;
      }).pipe(
        Effect.timeout('5 seconds'),
        Effect.retry({
          schedule: Schedule.exponential('100 millis').pipe(Schedule.intersect(Schedule.recurs(3))),
        }),
        Effect.catchAll((error) =>
          Effect.logError('Delta processing failed (continuing)', {
            error,
            documentId: delta.documentId,
          }).pipe(Effect.as(0))
        )
      )
    ),

    Stream.runFold(0, (latestTimestamp, currentTimestamp) =>
      Math.max(latestTimestamp, currentTimestamp)
    )
  );

export const createBufferedStream = <T>(capacity: number, strategy: BufferStrategy) =>
  Effect.gen(function* () {
    let queue: Queue.Queue<T>;

    switch (strategy) {
      case 'dropping':
        queue = yield* Queue.dropping<T>(capacity);
        break;

      case 'sliding':
        queue = yield* Queue.sliding<T>(capacity);
        break;

      case 'suspending':
        queue = yield* Queue.bounded<T>(capacity);
        break;
    }

    return queue;
  });

export const applyRateLimit = (stream: Stream.Stream<Delta>, maxPerSecond: number) =>
  stream.pipe(
    Stream.throttle({
      cost: () => 1,
      units: maxPerSecond,
      duration: '1 second',
    })
  );

export const createAdaptiveRateLimitedStream = (source: Stream.Stream<Delta>) =>
  Effect.gen(function* () {
    const rateLimit = getAdaptiveRateLimit();

    yield* Effect.logInfo('Applying adaptive rate limit', {
      device: detectDeviceCapability(),
      maxDeltasPerSecond: rateLimit,
    });

    return applyRateLimit(source, rateLimit);
  });
