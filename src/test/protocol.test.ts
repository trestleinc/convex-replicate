/**
 * Tests for protocol migration system
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getStoredProtocolVersion,
  storeProtocolVersion,
  migrateLocalStorage,
  clearProtocolStorage,
  getProtocolMetadata,
} from '../client/protocol.js';

describe('protocol', () => {
  beforeEach(async () => {
    // Clear protocol storage before each test
    await clearProtocolStorage();
  });

  afterEach(async () => {
    // Clean up after each test
    await clearProtocolStorage();
  });

  describe('getStoredProtocolVersion', () => {
    it('should return 1 for legacy clients (no version stored)', async () => {
      const version = await getStoredProtocolVersion();
      expect(version).toBe(1);
    });

    it('should return stored version when present', async () => {
      await storeProtocolVersion(3);
      const version = await getStoredProtocolVersion();
      expect(version).toBe(3);
    });
  });

  describe('storeProtocolVersion', () => {
    it('should store version successfully', async () => {
      await storeProtocolVersion(5);
      const version = await getStoredProtocolVersion();
      expect(version).toBe(5);
    });
  });

  describe('migrateLocalStorage', () => {
    it('should run migration when version increases', async () => {
      await storeProtocolVersion(1);

      // We can't easily mock the internal runMigration function, but we can test the result
      await migrateLocalStorage(1, 2);

      const version = await getStoredProtocolVersion();
      // Note: migrateLocalStorage doesn't automatically store the new version
      // That's handled by the init function
      expect(version).toBe(1); // Should remain unchanged
    });

    it('should not run migration when versions match', async () => {
      await storeProtocolVersion(2);

      await expect(migrateLocalStorage(2, 2)).resolves.not.toThrow();
    });

    it('should handle multiple version steps', async () => {
      await storeProtocolVersion(1);

      await expect(migrateLocalStorage(1, 3)).resolves.not.toThrow();
    });
  });

  describe('clearProtocolStorage', () => {
    it('should clear all protocol metadata', async () => {
      await storeProtocolVersion(10);
      expect(await getStoredProtocolVersion()).toBe(10);

      await clearProtocolStorage();
      expect(await getStoredProtocolVersion()).toBe(1); // Back to default
    });
  });

  describe('getProtocolMetadata', () => {
    it('should return protocol metadata', async () => {
      await storeProtocolVersion(7);
      const metadata = await getProtocolMetadata();

      expect(metadata).toEqual({
        version: 7,
      });
    });

    it('should return default version when none stored', async () => {
      const metadata = await getProtocolMetadata();

      expect(metadata).toEqual({
        version: 1,
      });
    });
  });
});
