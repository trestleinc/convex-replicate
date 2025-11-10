import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

/**
 * Cron Jobs for Tasks Collection
 *
 * Schedules automatic compaction and pruning of CRDT storage.
 */

const crons = cronJobs();

// Daily compaction at 3am UTC
// Compacts CRDT deltas older than 90 days into efficient snapshots
crons.daily('compact tasks', { hourUTC: 3, minuteUTC: 0 }, internal.tasks.compact, {});

// Weekly snapshot cleanup on Sundays at 3am UTC
// Deletes snapshots older than 180 days (keeps 2 most recent)
crons.weekly(
  'prune tasks snapshots',
  { dayOfWeek: 'sunday', hourUTC: 3, minuteUTC: 0 },
  internal.tasks.prune,
  {}
);

export default crons;
