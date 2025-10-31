// Re-export all Convex functions (no triggers needed - client writes directly)
export {
  mutation,
  query,
  action,
  internalMutation,
  internalQuery,
  internalAction,
} from './_generated/server';
