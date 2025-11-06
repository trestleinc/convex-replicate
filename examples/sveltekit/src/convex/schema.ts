import { defineSchema } from 'convex/server';
import { v } from 'convex/values';
import { replicatedTable } from '@trestleinc/replicate/server';

export default defineSchema({
  tasks: replicatedTable(
    {
      // User-defined business logic fields only
      // version and timestamp are auto-injected by replicatedTable
      id: v.string(),
      text: v.string(),
      isCompleted: v.boolean(),
    },
    (table) => table.index('by_user_id', ['id']).index('by_timestamp', ['timestamp'])
  ),
});
