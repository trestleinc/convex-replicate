# Convex Sharded Counter Component

[![npm version](https://badge.fury.io/js/@convex-dev%2Fsharded-counter.svg)](https://badge.fury.io/js/@convex-dev%2Fsharded-counter)

<!-- START: Include on https://convex.dev/components -->

This component adds counters to Convex. It acts as a key-value store from
string to number, with sharding to increase throughput when updating values.

Since it's built on Convex, everything is automatically consistent, reactive,
and cached. Since it's built with [Components](https://convex.dev/components),
the operations are isolated and increment/decrement are atomic even if run in
parallel.

For example, if you want to display
[one million checkboxes](https://en.wikipedia.org/wiki/One_Million_Checkboxes)
[on your Convex site](https://www.youtube.com/watch?v=LRUWplYoejQ), you want to
count the checkboxes in real-time while allowing a lot of the boxes to change in
parallel.

More generally, whenever you have a counter that is changing frequently, you
can use this component to keep track of it efficiently.

```ts
export const checkBox = mutation({
  args: { i: v.number() },
  handler: async (ctx, args) => {
    const checkbox = await ctx.db
      .query("checkboxes")
      .withIndex("i", (q) => q.eq("i", args.i))
      .unique();
    if (!checkbox.isChecked) {
      await ctx.db.patch(checkbox._id, { isChecked: true });

      // Here we increment the number of checkboxes.
      await numCheckboxes.inc(ctx);
    }
  },
});
export const getCount = query({
  args: {},
  handler: async (ctx, _args) => {
    return await numCheckboxes.count(ctx);
  },
});
```

This relies on the assumption that you need to frequently modify the counter,
but only need to read its value from a query, or infrequently in a mutation.
If you read the count every time you modify it, you lose the sharding benefit.

## Pre-requisite: Convex

You'll need an existing Convex project to use the component.
Convex is a hosted backend platform, including a database, serverless functions,
and a ton more you can learn about [here](https://docs.convex.dev/get-started).

Run `npm create convex` or follow any of the [quickstarts](https://docs.convex.dev/home) to set one up.

## Installation

First, install the component package:

```ts
npm install @convex-dev/sharded-counter
```

Then, create a `convex.config.ts` file in your app's `convex/` folder and install the
component by calling `use`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import shardedCounter from "@convex-dev/sharded-counter/convex.config";

const app = defineApp();
app.use(shardedCounter);

export default app;
```

Finally, create a new `ShardedCounter` within your `convex/` folder, and point it to
the installed component.

```ts
import { components } from "./_generated/api";
import { ShardedCounter } from "@convex-dev/sharded-counter";

const counter = new ShardedCounter(components.shardedCounter);
```

## Updating and reading counters

Once you have a `ShardedCounter`, there are a few methods you can use to update
the counter for a key in a mutation or action.

```ts
await counter.add(ctx, "checkboxes", 5); // increment by 5
await counter.inc(ctx, "checkboxes"); // increment by 1
await counter.subtract(ctx, "checkboxes", 5); // decrement by 5
await counter.dec(ctx, "checkboxes"); // decrement by 1
await counter.reset(ctx, "checkboxes"); // reset to 0

const numCheckboxes = counter.for("checkboxes");
await numCheckboxes.inc(ctx); // increment
await numCheckboxes.dec(ctx); // decrement
await numCheckboxes.add(ctx, 5); // add 5
await numCheckboxes.subtract(ctx, 5); // subtract 5
await numCheckboxes.reset(ctx); // reset to 0
```

And you can read the counter's value in a query, mutation, or action.

```ts
await counter.count(ctx, "checkboxes");
await numCheckboxes.count(ctx);
```

See more example usage in [example.ts](./example/convex/example.ts).

## Sharding the counter

When a single document is modified by two mutations at the same time, the
mutations slow down to achieve
[serializable results](https://docs.convex.dev/database/advanced/occ).

To achieve high throughput, the ShardedCounter distributes counts across
multiple documents, called "shards". Increments and decrements update a random
shard, while queries of the total count read from all shards.

1. More shards => greater throughput when incrementing or decrementing.
2. Fewer shards => better latency when querying the count.

You can set the number of shards when initializing the ShardedCounter, either
setting it specially for each key:

```ts
const counter = new ShardedCounter(components.shardedCounter, {
  shards: { checkboxes: 100 }, // 100 shards for the key "checkboxes"
});
```

Or by setting a default that applies to all keys not specified in `shards`:

```ts
const counter = new ShardedCounter(components.shardedCounter, {
  shards: { checkboxes: 100 },
  defaultShards: 8,
});
```

The default number of shards if none is specified is 16.

Note your keys can be a subtype of string. e.g. if you want to store a count of
friends for each user, and you don't care about throughput for a single user,
you would declare ShardedCounter like so:

```ts
const friendCounts = new ShardedCounter<Id<"users">>(
  components.shardedCounter,
  { defaultShards: 1 },
);

// Decrement a user's friend count by 1
await friendsCount.dec(ctx, userId);
```

## Reduce contention on reads

Reading the count with `counter.count(ctx, "checkboxes")` reads from all shards
to get an accurate count. This takes a read dependency on all shard documents.

- In a query subscription, that means any change to the counter causes the query
  to rerun.
- In a mutation, that means any modification to the counter causes an
  [OCC](https://docs.convex.dev/error#1) conflict.

You can reduce contention by estimating the count: read from a smaller number
of shards and extrapolate based on the total number of shards.

```ts
const estimatedCheckboxCount = await counter.estimateCount(ctx, "checkboxes");
```

By default, this reads from a single random shard and multiplies by the total
number of shards to form an estimate. You can improve the estimate by reading
from more shards, at the cost of more contention:

```ts
const estimateFromThree = await counter.estimateCount(ctx, "checkboxes", 3);
```

If the counter was accumulated from many
small `counter.inc` and `counter.dec` calls, then they should be uniformly
distributed across the shards, so estimated counts will be accurate.

In some cases the counter will not be evenly distributed:

- If the counter was accumulated from few operations
- If some operations were `counter.add`s or `counter.subtract`s with large
  values, because each operation only changes a single shard
- If the number of shards changed

In these cases, the count might not be evenly distributed across the shards.
To repair such cases, you can call:

```ts
await counter.rebalance(ctx, "checkboxes");
```

Which will even out the count across shards.

You may change the number of shards for a key, by changing the second argument
to the `ShardedCounter` constructor. If you decrease the number of shards,
you will be left with extra shards that won't be written to but are still
read when computing `count`.
In this case, you should call `counter.rebalance` to delete
the extraneous shards.

NOTE: `counter.rebalance` reads and writes all shards, so it could cause
more OCCs, and it's recommended you call it sparingly, from the Convex dashboard
or from an infrequent cron.

NOTE: counts are floats, and floating point arithmetic isn't infinitely
precise. Even if you always add and subtract integers, you may get a fractional
counts, especially if you use `estimateCount` or `rebalance`.
Values distributed across shards may be added in different combinations, and
[floating point arithmetic isn't associative](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html).
You can use `Math.round` to ensure your final count is an integer, if
desired.

## Counting documents in a table

Often you want to use a sharded counter to track how many documents are in a
table.

> If you want more than just a count, take a look at the
> [Aggregate component](https://www.npmjs.com/package/@convex-dev/aggregate).

There are three ways to go about keeping a count in sync with a table:

1. Be careful to always update the aggregate in any mutation that inserts or
   deletes from the table.
2. \[Recommended\] Place all writes to a table in separate TypeScript functions,
   and always call these functions from mutations instead of writing to the db
   directly. This method is recommended, because it encapsulates the logic for
   updating a table, while still keeping all operations explicit. For example,

```ts
// Example of a mutation that calls `insertUser`.
export const insertPair = mutation(async (ctx) => {
  ...
  await insertUser(ctx, user1);
  await insertUser(ctx, user2);
});

// All inserts to the "users" table go through this function.
async function insertUser(ctx, user) {
  await ctx.db.insert("users", user);
  await counter.inc(ctx, "users");
}
```

3. Register a [Trigger](https://www.npmjs.com/package/convex-helpers#triggers),
   which automatically runs code when a mutation changes the
   data in a table.

```ts
// Triggers hook up writes to the table to the ShardedCounter.
const triggers = new Triggers<DataModel>();
triggers.register("mytable", counter.trigger("mycounter"));
export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
```

The [insertUserWithTrigger](example/convex/example.ts) mutation uses a trigger.

## Backfilling an existing count

If you want to count items like documents in a table, you may already have
documents before installing the ShardedCounter component, and these should be
accounted for.

The easy version of this is to calculate the value once and add that value, if
there aren't active requests happening. You can also periodically re-calculate
the value and update the counter, if there aren't in-flight requests.

The tricky part is handling requests while doing the calculation: making sure to
merge active updates to counts with old values that you want to backfill.

### Simple backfill: if table is append-only

See example code at the bottom of
[example/convex/example.ts](example/convex/example.ts).

Walkthrough of steps:

1. Change live writes to update the counter. In the example, you would be
   changing `insertUserBeforeBackfill` to be implemented as
   `insertUserAfterBackfill`.
2. Write a backfill that counts documents that were created before the code from
   (1) deployed. In the example, this would be `backfillOldUsers`.
3. Run `backfillOldUsers` from the dashboard.

### Complex backfill: if documents may be deleted

See example code at the bottom of
[example/convex/example.ts](example/convex/example.ts).

Walkthrough of steps:

1. Create `backfillCursor` table in schema.ts
2. Create a new document in this table, with fields
   `{ creationTime: 0, id: "", isDone: false }`
3. Wherever you want to update a counter based on a document changing, wrap the
   update in a conditional, so it only gets updated if the backfill has processed
   that document. In the example, you would be changing `insertUserBeforeBackfill`
   to be implemented as `insertUserDuringBackfill`.
4. Define backfill functions similar to `backfillUsers` and `backfillUsersBatch`
5. Call `backfillUsersBatch` from the dashboard.
6. Remove the conditional when updating counters. In the example, you would be
   changing `insertUserDuringBackfill` to be implemented as
   `insertUserAfterBackfill`.
7. Delete the `backfillCursor` table.

<!-- END: Include on https://convex.dev/components -->
