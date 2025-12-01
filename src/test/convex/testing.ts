import { customMutation } from 'convex-helpers/server/customFunctions';
import { mutation as baseMutation } from './_generated/server';

/**
 * Test-only mutation wrapper that:
 * 1. Only runs when IS_TEST env var is set
 * 2. Prevents accidental execution in production
 *
 * Based on Convex testing pattern:
 * https://stack.convex.dev/testing-with-local-oss-backend
 */
export const testingMutation = customMutation(baseMutation, {
  args: {},
  input: async (_ctx, _args) => {
    if (process.env.IS_TEST === undefined) {
      throw new Error('Calling a test-only function in non-test environment');
    }
    return { ctx: {}, args: {} };
  },
});
