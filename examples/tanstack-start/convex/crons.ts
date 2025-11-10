import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Daily compaction at 3am UTC
// Compacts CRDT deltas older than 90 days for all collections
crons.daily('compact CRDT storage', { hourUTC: 3, minuteUTC: 0 }, internal.replicate.compact, {
  cutoffDays: 90,
});

// Weekly snapshot cleanup on Sundays at 3am UTC
// Deletes snapshots older than 180 days (keeps latest 2 per collection)
crons.weekly(
  'cleanup old snapshots',
  { dayOfWeek: 'sunday', hourUTC: 3, minuteUTC: 0 },
  internal.replicate.prune,
  { retentionDays: 180 }
);

export default crons;
