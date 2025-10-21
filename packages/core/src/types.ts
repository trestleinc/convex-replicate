// ========================================
// SHARED TYPE DEFINITIONS
// ========================================

/**
 * RxDB JSON Schema type for defining collection schemas
 */
export interface RxJsonSchema<_T = any> {
  title: string;
  version: number;
  type: 'object';
  primaryKey: string;
  properties: Record<string, any>;
  required: string[];
  indexes?: string[][];
}
