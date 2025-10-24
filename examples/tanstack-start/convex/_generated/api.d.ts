/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{}>;
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {
  storage: {
    public: {
      changeStream: FunctionReference<
        "query",
        "internal",
        { collectionName: string },
        { count: number; timestamp: number; totalSize: number }
      >;
      getDocumentMetadata: FunctionReference<
        "query",
        "internal",
        { collectionName: string; documentId: string },
        null | {
          changeCount: number;
          documentId: string;
          latestChange: null | {
            hash: string;
            size: number;
            timestamp: number;
          };
          latestSnapshot: null | {
            hash: string;
            size: number;
            timestamp: number;
          };
          snapshotCount: number;
        }
      >;
      pullChanges: FunctionReference<
        "query",
        "internal",
        {
          checkpoint: { lastModified: number };
          collectionName: string;
          limit?: number;
        },
        {
          changes: Array<{
            data: ArrayBuffer;
            documentId: string;
            size: number;
            timestamp: number;
            type: "snapshot" | "change";
          }>;
          checkpoint: { lastModified: number };
          hasMore: boolean;
        }
      >;
      submitBatch: FunctionReference<
        "mutation",
        "internal",
        {
          operations: Array<{
            collectionName: string;
            data: ArrayBuffer;
            documentId: string;
            type: "snapshot" | "change";
          }>;
        },
        Array<{ deduplicated: boolean; id: string }>
      >;
      submitChange: FunctionReference<
        "mutation",
        "internal",
        { collectionName: string; data: ArrayBuffer; documentId: string },
        { deduplicated: boolean; id: string }
      >;
      submitSnapshot: FunctionReference<
        "mutation",
        "internal",
        { collectionName: string; data: ArrayBuffer; documentId: string },
        { deduplicated: boolean; id: string }
      >;
    };
  };
};
