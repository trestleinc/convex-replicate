import { defineSchema } from 'convex/server';

/**
 * Component example schema
 *
 * This example uses pure CRDT storage via the replicate component.
 * No main application tables are needed since we're only demonstrating
 * component storage functionality.
 */
export default defineSchema({
  // No tables needed - using component storage only
});
