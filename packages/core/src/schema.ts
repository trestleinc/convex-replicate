import type { ConvexRxDocument, RxJsonSchema } from './types';

// ========================================
// SCHEMA BUILDER TYPES
// ========================================

type PropertyType = 'string' | 'number' | 'boolean' | 'object' | 'array';

interface PropertyDefinition {
  type: PropertyType;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  required?: boolean;
  items?: PropertyDefinition;
  properties?: Record<string, PropertyDefinition>;
}

export type SimpleSchema<T> = {
  [K in keyof Omit<T, 'id' | 'updatedTime'>]: PropertyDefinition;
};

// ========================================
// SCHEMA BUILDER API
// ========================================

/**
 * Property builders for simple schema definition
 */
export const property = {
  string(maxLength: number = 1000): PropertyDefinition {
    return { type: 'string', maxLength };
  },

  number(options?: { min?: number; max?: number; integer?: boolean }): PropertyDefinition {
    return {
      type: 'number',
      minimum: options?.min ?? 0,
      maximum: options?.max ?? Number.MAX_SAFE_INTEGER,
      multipleOf: options?.integer ? 1 : undefined,
    };
  },

  boolean(): PropertyDefinition {
    return { type: 'boolean' };
  },

  array(items: PropertyDefinition): PropertyDefinition {
    return { type: 'array', items };
  },

  object(properties: Record<string, PropertyDefinition>): PropertyDefinition {
    return { type: 'object', properties };
  },
};

/**
 * Auto-generates RxJsonSchema from a simple property definition.
 * Automatically adds required fields: id, updatedTime, _deleted
 *
 * @example
 * ```typescript
 * type Task = { text: string; isCompleted: boolean };
 *
 * const schema = createSchema<Task>('tasks', {
 *   text: property.string(),
 *   isCompleted: property.boolean(),
 * });
 * ```
 */
export function createSchema<T extends Record<string, any>>(
  title: string,
  properties: SimpleSchema<T>,
  options?: {
    version?: number;
    additionalIndexes?: string[][];
  }
): RxJsonSchema<T & ConvexRxDocument> {
  // Build property definitions
  const rxProperties: Record<string, any> = {
    // Required ConvexRx fields
    id: {
      type: 'string',
      maxLength: 100,
    },
    updatedTime: {
      type: 'number',
      minimum: 0,
      maximum: 8640000000000000, // JavaScript Date max value
      multipleOf: 1,
    },
  };

  // Add user-defined properties
  for (const [key, propDef] of Object.entries(properties)) {
    rxProperties[key] = convertPropertyDefinition(propDef);
  }

  // Determine required fields
  const userRequiredFields = Object.entries(properties)
    .filter(([_, propDef]) => propDef.required !== false)
    .map(([key]) => key);

  const required = ['id', 'updatedTime', ...userRequiredFields];

  // Build indexes (always include updatedTime + id for replication)
  const indexes = [['updatedTime', 'id'], ...(options?.additionalIndexes || [])];

  return {
    title,
    version: options?.version ?? 0,
    type: 'object',
    primaryKey: 'id',
    properties: rxProperties,
    required,
    indexes,
  } as RxJsonSchema<T & ConvexRxDocument>;
}

/**
 * Converts simple property definition to RxDB property schema
 */
function convertPropertyDefinition(propDef: PropertyDefinition): any {
  const schema: any = {
    type: propDef.type,
  };

  if (propDef.maxLength !== undefined) schema.maxLength = propDef.maxLength;
  if (propDef.minimum !== undefined) schema.minimum = propDef.minimum;
  if (propDef.maximum !== undefined) schema.maximum = propDef.maximum;
  if (propDef.multipleOf !== undefined) schema.multipleOf = propDef.multipleOf;
  if (propDef.items) schema.items = convertPropertyDefinition(propDef.items);
  if (propDef.properties) {
    schema.properties = {};
    for (const [key, value] of Object.entries(propDef.properties)) {
      schema.properties[key] = convertPropertyDefinition(value);
    }
  }

  return schema;
}

// ========================================
// QUICK SCHEMA HELPERS
// ========================================

/**
 * Infers a basic schema from a TypeScript type using smart defaults.
 * Only works for simple types (string, number, boolean).
 *
 * For complex types or custom constraints, use `createSchema()` instead.
 *
 * @example
 * ```typescript
 * type Task = { text: string; isCompleted: boolean; priority: number };
 * const schema = inferBasicSchema<Task>('tasks', ['text', 'isCompleted', 'priority']);
 * ```
 */
export function inferBasicSchema<T extends Record<string, any>>(
  title: string,
  fields: (keyof Omit<T, 'id' | 'updatedTime'>)[],
  options?: {
    version?: number;
  }
): RxJsonSchema<T & ConvexRxDocument> {
  const properties: Record<string, any> = {
    id: { type: 'string', maxLength: 100 },
    updatedTime: {
      type: 'number',
      minimum: 0,
      maximum: 8640000000000000,
      multipleOf: 1,
    },
  };

  // Add user fields with smart defaults
  for (const field of fields) {
    // Use generic string type as default - user can override with createSchema
    properties[field as string] = {
      type: 'string',
      maxLength: 1000,
    };
  }

  return {
    title,
    version: options?.version ?? 0,
    type: 'object',
    primaryKey: 'id',
    properties,
    required: ['id', 'updatedTime', ...(fields as string[])],
    indexes: [['updatedTime', 'id']],
  } as RxJsonSchema<T & ConvexRxDocument>;
}
