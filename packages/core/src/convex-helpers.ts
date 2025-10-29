import type { GenericDataModel, GenericMutationCtx, GenericQueryCtx } from 'convex/server';

export async function submitDocumentHelper<DataModel extends GenericDataModel>(
  ctx: GenericMutationCtx<DataModel>,
  components: any,
  tableName: string,
  args: { id: string; document: any; version: number }
): Promise<{ success: boolean }> {
  await ctx.runMutation(components.storage.public.submitDocument, {
    collectionName: tableName,
    documentId: args.id,
    document: args.document,
    version: args.version,
  });

  const db = ctx.db as any;
  const existing = await db
    .query(tableName)
    .withIndex('by_user_id', (q: any) => q.eq('id', args.id))
    .first();

  if (existing) {
    await db.patch(existing._id, {
      ...args.document,
      version: args.version,
      timestamp: Date.now(),
    });
  } else {
    await db.insert(tableName, {
      id: args.id,
      ...args.document,
      version: args.version,
      timestamp: Date.now(),
    });
  }

  return { success: true };
}

export async function pullChangesHelper<DataModel extends GenericDataModel>(
  ctx: GenericQueryCtx<DataModel>,
  tableName: string,
  args: { checkpoint: { lastModified: number }; limit?: number }
): Promise<{
  changes: Array<{
    documentId: any;
    document: any;
    version: any;
    timestamp: any;
  }>;
  checkpoint: { lastModified: number };
  hasMore: boolean;
}> {
  const db = ctx.db as any;
  const docs = await db
    .query(tableName)
    .withIndex('by_timestamp', (q: any) => q.gt('timestamp', args.checkpoint.lastModified))
    .order('asc')
    .take(args.limit ?? 100);

  return {
    changes: docs.map((doc: any) => {
      const { _id, _creationTime, timestamp: _timestamp, version: _version, ...rest } = doc;
      return {
        documentId: doc.id,
        document: rest,
        version: doc.version,
        timestamp: doc.timestamp,
      };
    }),
    checkpoint: {
      lastModified: docs[docs.length - 1]?.timestamp ?? args.checkpoint.lastModified,
    },
    hasMore: docs.length === (args.limit ?? 100),
  };
}

export async function changeStreamHelper<DataModel extends GenericDataModel>(
  ctx: GenericQueryCtx<DataModel>,
  tableName: string
): Promise<{ timestamp: number; count: number }> {
  const db = ctx.db as any;
  const allDocs = await db.query(tableName).collect();
  let latestTimestamp = 0;

  for (const doc of allDocs) {
    if (doc.timestamp > latestTimestamp) {
      latestTimestamp = doc.timestamp;
    }
  }

  return {
    timestamp: latestTimestamp,
    count: allDocs.length,
  };
}
