/**
 * Network Simulation Utilities
 * For testing offline/online replication scenarios
 */

export type NetworkState = 'online' | 'offline';

export interface NetworkEvent {
  clientId: string;
  previousState: NetworkState;
  newState: NetworkState;
  timestamp: number;
}

/**
 * Simulates network connectivity for stress testing
 * Tracks which clients are offline and provides utilities for partition simulation
 */
export class NetworkSimulator {
  private clientStates: Map<string, NetworkState> = new Map();
  private eventLog: NetworkEvent[] = [];
  private stateChangeCallbacks: Map<string, ((state: NetworkState) => void)[]> = new Map();

  /**
   * Register a client with the simulator
   */
  registerClient(clientId: string, initialState: NetworkState = 'online'): void {
    this.clientStates.set(clientId, initialState);
  }

  /**
   * Set a client to offline state
   */
  goOffline(clientId: string): void {
    this.setState(clientId, 'offline');
  }

  /**
   * Set a client to online state
   */
  goOnline(clientId: string): void {
    this.setState(clientId, 'online');
  }

  /**
   * Set the network state for a client
   */
  setState(clientId: string, state: NetworkState): void {
    const previousState = this.clientStates.get(clientId) ?? 'online';

    if (previousState !== state) {
      this.clientStates.set(clientId, state);

      const event: NetworkEvent = {
        clientId,
        previousState,
        newState: state,
        timestamp: Date.now(),
      };
      this.eventLog.push(event);

      // Notify callbacks
      const callbacks = this.stateChangeCallbacks.get(clientId) ?? [];
      for (const callback of callbacks) {
        callback(state);
      }
    }
  }

  /**
   * Check if a client is offline
   */
  isOffline(clientId: string): boolean {
    return this.clientStates.get(clientId) === 'offline';
  }

  /**
   * Check if a client is online
   */
  isOnline(clientId: string): boolean {
    return this.clientStates.get(clientId) !== 'offline';
  }

  /**
   * Get the current state of a client
   */
  getState(clientId: string): NetworkState {
    return this.clientStates.get(clientId) ?? 'online';
  }

  /**
   * Get all offline client IDs
   */
  getOfflineClients(): string[] {
    return Array.from(this.clientStates.entries())
      .filter(([, state]) => state === 'offline')
      .map(([id]) => id);
  }

  /**
   * Get all online client IDs
   */
  getOnlineClients(): string[] {
    return Array.from(this.clientStates.entries())
      .filter(([, state]) => state === 'online')
      .map(([id]) => id);
  }

  /**
   * Subscribe to state changes for a client
   */
  onStateChange(clientId: string, callback: (state: NetworkState) => void): () => void {
    const callbacks = this.stateChangeCallbacks.get(clientId) ?? [];
    callbacks.push(callback);
    this.stateChangeCallbacks.set(clientId, callbacks);

    // Return unsubscribe function
    return () => {
      const updated = this.stateChangeCallbacks.get(clientId) ?? [];
      const index = updated.indexOf(callback);
      if (index !== -1) {
        updated.splice(index, 1);
        this.stateChangeCallbacks.set(clientId, updated);
      }
    };
  }

  /**
   * Simulate a network partition for multiple clients
   * Takes clients offline for a specified duration, then brings them back online
   */
  async partition(clientIds: string[], durationMs: number): Promise<void> {
    // Take all clients offline
    for (const clientId of clientIds) {
      this.goOffline(clientId);
    }

    // Wait for partition duration
    await new Promise((resolve) => setTimeout(resolve, durationMs));

    // Bring all clients back online
    for (const clientId of clientIds) {
      this.goOnline(clientId);
    }
  }

  /**
   * Reconnect clients one by one with a delay between each
   */
  async staggeredReconnect(clientIds: string[], intervalMs: number): Promise<void> {
    for (const clientId of clientIds) {
      this.goOnline(clientId);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  /**
   * Disconnect clients one by one with a delay between each
   */
  async staggeredDisconnect(clientIds: string[], intervalMs: number): Promise<void> {
    for (const clientId of clientIds) {
      this.goOffline(clientId);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  /**
   * Simulate flaky network (random disconnects/reconnects)
   */
  async simulateFlakyNetwork(
    clientIds: string[],
    durationMs: number,
    options: {
      disconnectProbability?: number;
      reconnectProbability?: number;
      checkIntervalMs?: number;
    } = {}
  ): Promise<void> {
    const {
      disconnectProbability = 0.1,
      reconnectProbability = 0.3,
      checkIntervalMs = 100,
    } = options;

    const startTime = Date.now();

    while (Date.now() - startTime < durationMs) {
      for (const clientId of clientIds) {
        const isOffline = this.isOffline(clientId);

        if (isOffline && Math.random() < reconnectProbability) {
          this.goOnline(clientId);
        } else if (!isOffline && Math.random() < disconnectProbability) {
          this.goOffline(clientId);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
    }

    // Ensure all clients are online at the end
    for (const clientId of clientIds) {
      this.goOnline(clientId);
    }
  }

  /**
   * Get the event log
   */
  getEventLog(): NetworkEvent[] {
    return [...this.eventLog];
  }

  /**
   * Clear the event log
   */
  clearEventLog(): void {
    this.eventLog = [];
  }

  /**
   * Reset all client states to online and clear event log
   */
  reset(): void {
    for (const clientId of this.clientStates.keys()) {
      this.clientStates.set(clientId, 'online');
    }
    this.eventLog = [];
  }

  /**
   * Unregister a client
   */
  unregisterClient(clientId: string): void {
    this.clientStates.delete(clientId);
    this.stateChangeCallbacks.delete(clientId);
  }

  /**
   * Unregister all clients
   */
  unregisterAll(): void {
    this.clientStates.clear();
    this.stateChangeCallbacks.clear();
    this.eventLog = [];
  }
}

/**
 * Create a network simulator instance
 */
export function createNetworkSimulator(): NetworkSimulator {
  return new NetworkSimulator();
}
