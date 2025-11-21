import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export type ReplicationFields = {
  version: number;
  timestamp: number;
};

export function replicatedTable(
  userFields: Record<string, any>,
  applyIndexes?: (table: any) => any
): any {
  const table = defineTable({
    ...userFields,
    version: v.number(),
    timestamp: v.number(),
  });

  if (applyIndexes) {
    return applyIndexes(table);
  }

  return table;
}
