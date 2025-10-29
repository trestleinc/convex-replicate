import type { GenericDataModel, GenericMutationCtx, GenericQueryCtx } from 'convex/server';

function cleanDocument(doc: any): any {
  return Object.fromEntries(
    Object.entries(doc).filter(([_, value]) => value !== undefined && value !== null)
  );
}

export async function submitDocumentHelper<DataModel extends GenericDataModel>(
  ctx: any,
  components: any,
  tableName: string,
  args: { id: string; document: any; version: number }
): Promise<{ success: boolean }> {
  await ctx.runMutation(components.replicate.public.submitDocument, {
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

  const cleanDoc = cleanDocument(args.document);

  if (existing) {
    await db.patch(existing._id, {
      ...cleanDoc,
      version: args.version,
      timestamp: Date.now(),
    });
  } else {
    await db.insert(tableName, {
      id: args.id,
      ...cleanDoc,
      version: args.version,
      timestamp: Date.now(),
    });
  }

  return { success: true };
}

export async function pullChangesHelper<DataModel extends GenericDataModel>(
  ctx: any,
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

  const activeChanges = docs
    .filter((doc: any) => doc.deleted !== true)
    .map((doc: any) => {
      const {
        _id,
        _creationTime,
        timestamp: _timestamp,
        version: _version,
        deleted: _deleted,
        ...rest
      } = doc;
      return {
        documentId: doc.id,
        document: rest,
        version: doc.version,
        timestamp: doc.timestamp,
      };
    });

  return {
    changes: activeChanges,
    checkpoint: {
      lastModified: docs[docs.length - 1]?.timestamp ?? args.checkpoint.lastModified,
    },
    hasMore: docs.length === (args.limit ?? 100),
  };
}

export async function changeStreamHelper<DataModel extends GenericDataModel>(
  ctx: any,
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
