import { query } from './_generated/server';
import { components } from './_generated/api';

/**
 * Get the protocol version from the replicate component.
 * This wrapper is required for the client to check protocol compatibility.
 */
export const getProtocolVersion = query({
  handler: async (ctx) => {
    return await ctx.runQuery(components.replicate.public.getProtocolVersion);
  },
});
