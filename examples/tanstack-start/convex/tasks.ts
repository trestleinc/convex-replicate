import { generateConvexRxFunctions } from '@convex-rx/core';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// ========================================
// AUTO-GENERATED CONVEX FUNCTIONS
// ========================================

// This single call generates all 3 required functions:
// - changeStream: Detects changes for real-time sync
// - pullDocuments: Pulls documents from server
// - pushDocuments: Pushes local changes to server
const taskFunctions = generateConvexRxFunctions({
  tableName: 'tasks',
  query,
  mutation,
  v,
});

export const changeStream = taskFunctions.changeStream;
export const pullDocuments = taskFunctions.pullDocuments;
export const pushDocuments = taskFunctions.pushDocuments;
