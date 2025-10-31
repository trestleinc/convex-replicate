/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as storageTests from "../storageTests.js";

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
declare const fullApi: ApiFromModules<{
  storageTests: typeof storageTests;
}>;
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
  replicate: {
    public: {
      changeStream: FunctionReference<
        "query",
        "internal",
        { collectionName: string },
        { count: number; timestamp: number }
      >;
      deleteDocument: FunctionReference<
        "mutation",
        "internal",
        { collectionName: string; documentId: string },
        { success: boolean }
      >;
      insertDocument: FunctionReference<
        "mutation",
        "internal",
        {
          collectionName: string;
          crdtBytes: ArrayBuffer;
          documentId: string;
          version: number;
        },
        { success: boolean }
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
            crdtBytes: ArrayBuffer;
            documentId: string;
            timestamp: number;
            version: number;
          }>;
          checkpoint: { lastModified: number };
          hasMore: boolean;
        }
      >;
      updateDocument: FunctionReference<
        "mutation",
        "internal",
        {
          collectionName: string;
          crdtBytes: ArrayBuffer;
          documentId: string;
          version: number;
        },
        { success: boolean }
      >;
    };
  };
};
