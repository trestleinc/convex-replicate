/**
 * Effect.js Testing Utilities
 *
 * Common helpers for testing Effect-based services
 */

import { Effect, type Either, type Layer } from 'effect';

/**
 * Run an Effect test with automatic layer provision
 */
export async function runEffectTest<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R>
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

/**
 * Run an Effect test expecting it may succeed or fail
 * Returns Either for error inspection
 */
export async function runEffectTestEither<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R>
): Promise<Either.Either<A, E>> {
  return Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.either));
}

/**
 * Assert that an Either result is a Left (error) with a specific tag
 */
export function expectErrorTag<E extends { _tag: string }>(
  result: Either.Either<unknown, E>,
  expectedTag: string
): asserts result is Either.Left<E, unknown> {
  if (result._tag !== 'Left') {
    throw new Error(`Expected Left but got Right`);
  }
  if (result.left._tag !== expectedTag) {
    throw new Error(`Expected error tag '${expectedTag}' but got '${result.left._tag}'`);
  }
}

/**
 * Assert that an Either result is a Right (success)
 */
export function expectSuccess<A, E>(
  result: Either.Either<A, E>
): asserts result is Either.Right<E, A> {
  if (result._tag !== 'Right') {
    throw new Error(`Expected Right but got Left: ${JSON.stringify(result.left)}`);
  }
}

/**
 * Wait for fire-and-forget Effect.runPromise calls to settle
 * Use after triggering subscription updates that run handlers asynchronously
 */
export async function flushEffectPromises(ms = 50): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a deferred promise for testing async completion
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
