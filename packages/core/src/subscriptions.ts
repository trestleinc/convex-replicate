/**
 * Subscription builder utilities.
 *
 * Provides helpers for creating and managing custom subscriptions
 * to RxDB collection changes and sync events.
 *
 * Framework-agnostic - works with any reactive system.
 */

/**
 * Generic subscription builder type.
 * Framework packages can specialize this with their own context types.
 *
 * @template TContext - Context type provided to builders (varies by framework)
 * @template TSubscriptions - Object with subscription methods
 */
export type SubscriptionBuilder<TContext, TSubscriptions extends Record<string, (...args: any[]) => (() => void) | { unsubscribe: () => void }>> = (
  context: TContext,
) => TSubscriptions;

/**
 * Build custom subscriptions from user-provided builder function.
 *
 * @param builder - User's subscription builder function
 * @param context - Framework-specific context (e.g., HookContext in React)
 * @returns Object with subscription methods, or empty object if no builder
 *
 * @example
 * ```typescript
 * const subscriptions = buildSubscriptions(
 *   (ctx) => ({
 *     onChange: (callback) => ctx.rxCollection.$.subscribe(callback),
 *   }),
 *   context
 * );
 * ```
 */
export function buildSubscriptions<
  TContext,
  TSubscriptions extends Record<string, (...args: any[]) => (() => void) | { unsubscribe: () => void }>,
>(
  builder: SubscriptionBuilder<TContext, TSubscriptions> | undefined,
  context: TContext,
): TSubscriptions {
  if (!builder) {
    return {} as TSubscriptions;
  }

  return builder(context);
}

/**
 * Helper to normalize unsubscribe functions.
 * Some subscriptions return `() => void`, others return `{ unsubscribe: () => void }`.
 *
 * This utility ensures a consistent interface for cleanup.
 *
 * @param subscription - Subscription result (function or object)
 * @returns Normalized unsubscribe function
 *
 * @example
 * ```typescript
 * const sub = rxCollection.$.subscribe(handler);
 * const cleanup = normalizeUnsubscribe(sub); // { unsubscribe: () => void } -> () => void
 * cleanup(); // Always call as function
 * ```
 */
export function normalizeUnsubscribe(
  subscription: (() => void) | { unsubscribe: () => void },
): () => void {
  if (typeof subscription === 'function') {
    return subscription;
  }
  return () => subscription.unsubscribe();
}
