import { generateConvexRxFunctions } from '@convex-rx/core';
import type { RegisteredMutation, RegisteredQuery } from 'convex/server';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// ========================================
// AUTO-GENERATED CONVEX FUNCTIONS
// ========================================

// Generate the functions
const taskFunctions = generateConvexRxFunctions({
  tableName: 'tasks',
  query,
  mutation,
  v,
});

// Export with explicit type annotations to preserve types through Convex's FilterApi
// This is required because TypeScript doesn't preserve literal type properties
// (isConvexFunction: true) through destructured exports or type aliases
export const changeStream: RegisteredQuery<
  'public',
  Record<string, never>,
  { timestamp: number; count: number }
> = taskFunctions.changeStream;

export const pullDocuments: RegisteredQuery<
  'public',
  { checkpoint: any; limit: number },
  { documents: any[]; checkpoint: any }
> = taskFunctions.pullDocuments;

export const pushDocuments: RegisteredMutation<'public', { changeRows: any[] }, any[]> =
  taskFunctions.pushDocuments;
