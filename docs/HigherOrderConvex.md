# Higher-Order Convex Function Generation - Type Preservation Investigation

## Overview

This document details our investigation into automatically generating and exporting Convex functions from `@convex-rx/core` with proper type preservation through TypeScript's module boundaries.

## The Problem

**Goal**: Auto-generate the 3 required Convex functions (`changeStream`, `pullDocuments`, `pushDocuments`) for any table without requiring users to manually write boilerplate.

**Challenge**: Convex's type system uses `FilterApi` to filter module exports based on a literal type property check:

```typescript
// From convex/server/api.d.ts
type FunctionReferencesInModule<Module extends Record<string, any>> = {
  -readonly [ExportName in keyof Module as Module[ExportName]["isConvexFunction"] extends true ? ExportName : never]:
    FunctionReferenceFromExport<Module[ExportName]>;
};
```

This checks if each export has `isConvexFunction: true` as a **literal type property**. TypeScript must preserve this property at the module boundary for Convex's code generator to recognize the function.

## Type Definitions

The `RegisteredQuery` and `RegisteredMutation` types from Convex include literal properties:

```typescript
// From convex/server/registration.d.ts
export type RegisteredQuery<Visibility, Args, Returns> = {
  isConvexFunction: true;  // ← LITERAL true, not boolean
  isQuery: true;
} & VisibilityProperties<Visibility>;

export type RegisteredMutation<Visibility, Args, Returns> = {
  isConvexFunction: true;  // ← LITERAL true, not boolean
  isMutation: true;
} & VisibilityProperties<Visibility>;
```

## Tested Scenarios

### Scenario 1: Intermediate Variable Without Type Annotations ❌

```typescript
const scenario1Functions = generateConvexRxFunctions({
  tableName: 'test1',
  query,
  mutation,
  v,
});

export const scenario1_changeStream = scenario1Functions.changeStream;
export const scenario1_pullDocuments = scenario1Functions.pullDocuments;
export const scenario1_pushDocuments = scenario1Functions.pushDocuments;
```

**Result**: ❌ Does not appear in `api` object
**Reason**: TypeScript infers the type from the intermediate variable, losing the literal `isConvexFunction: true` property at the module boundary.

---

### Scenario 2: Explicit Inline Type Annotations ✅

```typescript
import type { RegisteredQuery, RegisteredMutation } from 'convex/server';

const scenario2Functions = generateConvexRxFunctions({
  tableName: 'test2',
  query,
  mutation,
  v,
});

export const scenario2_changeStream: RegisteredQuery<
  'public',
  Record<string, never>,
  { timestamp: number; count: number }
> = scenario2Functions.changeStream;

export const scenario2_pullDocuments: RegisteredQuery<
  'public',
  { checkpoint: any; limit: number },
  { documents: any[]; checkpoint: any }
> = scenario2Functions.pullDocuments;

export const scenario2_pushDocuments: RegisteredMutation<
  'public',
  { changeRows: any[] },
  any[]
> = scenario2Functions.pushDocuments;
```

**Result**: ✅ **WORKS** - Appears in `api` object
**Reason**: Explicit type annotations with the concrete Convex types preserve the literal properties through the module boundary.

---

### Scenario 3: Direct Destructuring Without Annotations ❌

```typescript
export const {
  changeStream: scenario3_changeStream,
  pullDocuments: scenario3_pullDocuments,
  pushDocuments: scenario3_pushDocuments
} = generateConvexRxFunctions({
  tableName: 'test3',
  query,
  mutation,
  v,
});
```

**Result**: ❌ Does not appear in `api` object
**Reason**: TypeScript infers types for destructured exports, losing literal properties.

---

### Scenario 4: Direct Property Access Without Annotation ❌

```typescript
export const scenario4_changeStream = generateConvexRxFunctions({
  tableName: 'test4',
  query,
  mutation,
  v,
}).changeStream;
```

**Result**: ❌ Does not appear in `api` object
**Reason**: Type inference on property access doesn't preserve literal properties.

---

### Scenario 5: Type Aliases from Package ❌

```typescript
import type { ConvexRxChangeStream, ConvexRxPullDocuments, ConvexRxPushDocuments } from '@convex-rx/core';

const scenario5Functions = generateConvexRxFunctions({
  tableName: 'test5',
  query,
  mutation,
  v,
});

export const scenario5_changeStream: ConvexRxChangeStream = scenario5Functions.changeStream;
export const scenario5_pullDocuments: ConvexRxPullDocuments = scenario5Functions.pullDocuments;
export const scenario5_pushDocuments: ConvexRxPushDocuments = scenario5Functions.pushDocuments;
```

**Where**:
```typescript
// In @convex-rx/core
export type ConvexRxChangeStream = RegisteredQuery<
  'public',
  Record<string, never>,
  { timestamp: number; count: number }
>;
```

**Result**: ❌ Does not appear in `api` object
**Reason**: Type aliases from another package don't preserve literal properties at the module boundary, even though they're structurally identical.

---

### Scenario 6: Export Helper Function ❌

```typescript
import { exportConvexRxFunctions } from '@convex-rx/core';

export const {
  changeStream: scenario6_changeStream,
  pullDocuments: scenario6_pullDocuments,
  pushDocuments: scenario6_pushDocuments
} = exportConvexRxFunctions({
  tableName: 'test6',
  query,
  mutation,
  v,
});
```

**Where**:
```typescript
// In @convex-rx/core
export function exportConvexRxFunctions(config: {
  tableName: string;
  query: any;
  mutation: any;
  v: any;
}): {
  changeStream: RegisteredQuery<'public', Record<string, never>, { timestamp: number; count: number }>;
  pullDocuments: RegisteredQuery<'public', { checkpoint: any; limit: number }, { documents: any[]; checkpoint: any }>;
  pushDocuments: RegisteredMutation<'public', { changeRows: any[] }, any[]>;
} {
  const fns = generateConvexRxFunctions(config);
  return {
    changeStream: fns.changeStream as RegisteredQuery<...>,
    pullDocuments: fns.pullDocuments as RegisteredQuery<...>,
    pushDocuments: fns.pushDocuments as RegisteredMutation<...>,
  };
}
```

**Result**: ❌ Does not appear in `api` object
**Reason**: Even with an explicit return type on the function, destructured exports don't preserve literal properties.

## Root Cause Analysis

### TypeScript Module Boundary Behavior

When TypeScript compiles modules, it loses literal type properties in these scenarios:

1. **Type Inference on Exports**: When an export's type is inferred rather than explicitly annotated
2. **Cross-Package Type Aliases**: Type aliases from other packages, even when structurally identical
3. **Destructured Exports**: Destructuring from function returns, even with explicit function return types

### Why Only Scenario 2 Works

Only explicit inline type annotations using the **concrete types directly from the source package** (`'convex/server'`) preserve the literal properties through the module boundary.

## Solutions Considered

### ❌ 1. Code Generator / CLI Tool
**Pros**: Could automatically generate properly-typed exports
**Cons**: User explicitly rejected - wants automatic DX without build tools

### ❌ 2. Type Aliases from Core Package
**Pros**: Shorter import, less typing
**Cons**: Doesn't work - TypeScript loses literal properties through cross-package aliases

### ❌ 3. Export Helper Function
**Pros**: Single-line destructured export
**Cons**: Doesn't work - destructuring loses literal properties even with explicit return types

### ✅ 4. Explicit Inline Annotations (Current Solution)
**Pros**: Only pattern that works with Convex's type system
**Cons**: Verbose, requires users to write long type annotations

## Recommended Pattern

Until TypeScript's module system changes or Convex modifies their type filtering approach, users must use **Scenario 2**:

```typescript
import { generateConvexRxFunctions } from '@convex-rx/core';
import type { RegisteredMutation, RegisteredQuery } from 'convex/server';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// Generate functions
const taskFunctions = generateConvexRxFunctions({
  tableName: 'tasks',
  query,
  mutation,
  v,
});

// Export with explicit type annotations
export const changeStream: RegisteredQuery<
  'public',
  Record<string, never>,
  { timestamp: number; count: number }
> = taskFunctions.changeStream;

export const pullDocuments: RegisteredQuery<
  'public',
  { checkpoint: any; limit: number },
  { documents: any[]; checkpoint: any }
> = taskFunctions.pullDocuments;

export const pushDocuments: RegisteredMutation<
  'public',
  { changeRows: any[] },
  any[]
> = taskFunctions.pushDocuments;
```

## Future Exploration

Potential approaches that might work:

1. **TypeScript Compiler Plugin**: Modify how types are preserved at module boundaries
2. **Convex Type System Change**: Request Convex to use a different filtering mechanism that doesn't rely on literal properties
3. **Macro System**: Use a compile-time macro (like Babel plugin) to transform code
4. **Custom Language Server**: Extend TypeScript's language server to preserve properties

## Conclusion

The type preservation issue is a fundamental limitation of how TypeScript handles literal type properties across module boundaries combined with Convex's specific type filtering requirements.

**Key Takeaway**: Explicit inline type annotations using the concrete Convex types from `'convex/server'` are currently the only reliable way to ensure functions appear in Convex's generated `api` object.

---

**Investigation Date**: January 2025
**TypeScript Version**: 5.9.3
**Convex Version**: 1.28.0
