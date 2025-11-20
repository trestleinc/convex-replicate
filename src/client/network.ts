import { Stream, Effect } from 'effect';

// ============================================================================
// Browser Online/Offline Event Stream
// ============================================================================

/**
 * Creates a stream of network status events ('online' | 'offline').
 * SSR-safe - returns empty stream on server.
 */
export const networkStatusStream =
  typeof window !== 'undefined'
    ? Stream.async<'online' | 'offline'>((emit) => {
        const onlineHandler = () => emit.single('online');
        const offlineHandler = () => emit.single('offline');

        window.addEventListener('online', onlineHandler);
        window.addEventListener('offline', offlineHandler);

        return Effect.sync(() => {
          window.removeEventListener('online', onlineHandler);
          window.removeEventListener('offline', offlineHandler);
        });
      })
    : Stream.empty; // SSR-safe
