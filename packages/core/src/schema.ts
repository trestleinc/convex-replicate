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
  required?: boolean | string[];
  items?: PropertyDefinition;
  properties?: Record<string, PropertyDefinition>;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean;
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
      minimum: options?.min,
      maximum: options?.max ?? Number.MAX_SAFE_INTEGER,
      multipleOf: options?.integer ? 1 : undefined,
    };
  },

  positiveNumber(options?: { max?: number; integer?: boolean }): PropertyDefinition {
    return {
      type: 'number',
      minimum: 0,
      maximum: options?.max ?? Number.MAX_SAFE_INTEGER,
      multipleOf: options?.integer ? 1 : undefined,
    };
  },

  boolean(): PropertyDefinition {
    return { type: 'boolean' };
  },

  array(
    items: PropertyDefinition,
    options?: { minItems?: number; maxItems?: number }
  ): PropertyDefinition {
    return {
      type: 'array',
      items,
      minItems: options?.minItems,
      maxItems: options?.maxItems,
    };
  },

  object(
    properties: Record<string, PropertyDefinition>,
    options?: { required?: string[]; additionalProperties?: boolean }
  ): PropertyDefinition {
    return {
      type: 'object',
      properties,
      required: options?.required,
      additionalProperties: options?.additionalProperties ?? true,
    };
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
  if (propDef.minItems !== undefined) schema.minItems = propDef.minItems;
  if (propDef.maxItems !== undefined) schema.maxItems = propDef.maxItems;
  if (propDef.additionalProperties !== undefined) schema.additionalProperties = propDef.additionalProperties;
  if (propDef.items) schema.items = convertPropertyDefinition(propDef.items);
  if (propDef.properties) {
    schema.properties = {};
    for (const [key, value] of Object.entries(propDef.properties)) {
      schema.properties[key] = convertPropertyDefinition(value);
    }
  }
  if (Array.isArray(propDef.required)) {
    schema.required = propDef.required;
  }

  return schema;
}

// ========================================
// QUICK SCHEMA HELPERS
// ========================================

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

  for (const field of fields) {
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
