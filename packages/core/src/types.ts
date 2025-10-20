// ========================================
// TYPE DEFINITIONS
// ========================================

export interface RxJsonSchema<_T = any> {
  title: string;
  version: number;
  type: 'object';
  primaryKey: string;
  properties: Record<string, any>;
  required: string[];
  indexes?: string[][];
}

export interface ConvexSyncConfig<T> {
  convexClient: any; // Convex client instance (injected)
  tableName: string;
  schema: RxJsonSchema<T>;
  convexApi: {
    changeStream: any; // Convex function reference
    pullDocuments: any; // Convex function reference
    pushDocuments: any; // Convex function reference
  };
  databaseName?: string;
  batchSize?: number;
  retryTime?: number;
  enableLogging?: boolean;
}

export interface ConvexRxSyncInstance<_T = any> {
  rxDatabase: any;
  rxCollection: any;
  replicationState: any;
  tableName: string;
}
