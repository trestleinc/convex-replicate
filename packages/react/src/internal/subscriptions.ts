/**
 * Internal subscription builder utilities.
 *
 * Provides helpers for creating and managing custom subscriptions
 * to RxDB collection changes and sync events.
 */

import type { HookContext, SubscriptionBuilder, SyncedDocument } from '../types';

/**
 * Build custom subscriptions from user-provided builder function.
 *
 * @param builder - User's subscription builder function
 * @param context - Hook context with collection and replication state
 * @returns Object with subscription methods, or empty object if no builder
 */
export function buildSubscriptions<
	TData extends SyncedDocument,
	TSubscriptions extends Record<string, (...args: any[]) => (() => void) | { unsubscribe: () => void }>,
>(
	builder: SubscriptionBuilder<TData, TSubscriptions> | undefined,
	context: HookContext<TData>,
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
 * @param subscription - Subscription result
 * @returns Normalized unsubscribe function
 */
export function normalizeUnsubscribe(
	subscription: (() => void) | { unsubscribe: () => void },
): () => void {
	if (typeof subscription === 'function') {
		return subscription;
	}
	return () => subscription.unsubscribe();
}
