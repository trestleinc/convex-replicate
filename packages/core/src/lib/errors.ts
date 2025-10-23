import { z } from 'zod';
import { type Logger, getLogger as getLogTapeLogger } from '@logtape/logtape';

export const ErrorCategory = {
  INITIALIZATION: 'initialization',
  SCHEMA: 'schema',
  NETWORK: 'network',
  REPLICATION: 'replication',
  CONFLICT: 'conflict',
  VALIDATION: 'validation',
  STORAGE: 'storage',
  UNKNOWN: 'unknown',
} as const;

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

export const ErrorSeverity = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  FATAL: 'fatal',
} as const;

export type ErrorSeverity = (typeof ErrorSeverity)[keyof typeof ErrorSeverity];

export const RecoveryStrategy = {
  RETRY: 'retry',
  SKIP: 'skip',
  FALLBACK: 'fallback',
  MANUAL: 'manual',
  NONE: 'none',
} as const;

export type RecoveryStrategy = (typeof RecoveryStrategy)[keyof typeof RecoveryStrategy];

interface BaseConvexRxError {
  readonly category: ErrorCategory;
  readonly message: string;
  readonly severity: ErrorSeverity;
  readonly recovery: RecoveryStrategy;
  readonly timestamp: string;
  readonly cause?: unknown;
  readonly context?: Record<string, unknown>;
}

export interface InitializationError extends BaseConvexRxError {
  readonly category: typeof ErrorCategory.INITIALIZATION;
  readonly phase: 'database' | 'collection' | 'storage' | 'plugins' | 'replication';
  readonly databaseName: string;
  readonly collectionName?: string;
}

export interface SchemaError extends BaseConvexRxError {
  readonly category: typeof ErrorCategory.SCHEMA;
  readonly schemaName: string;
  readonly invalidFields: string[];
  readonly documentId?: string;
  readonly zodIssues?: z.ZodIssue[];
}

export interface NetworkError extends BaseConvexRxError {
  readonly category: typeof ErrorCategory.NETWORK;
  readonly operation: 'pull' | 'push' | 'changeStream' | 'query' | 'mutation';
  readonly endpoint?: string;
  readonly statusCode?: number;
  readonly isOnline: boolean;
  readonly retryAttempt?: number;
  readonly maxRetries?: number;
}

export interface ReplicationError extends BaseConvexRxError {
  readonly category: typeof ErrorCategory.REPLICATION;
  readonly direction: 'pull' | 'push' | 'bidirectional';
  readonly collectionName: string;
  readonly documentCount?: number;
  readonly checkpoint?: { id: string; updatedTime: number };
  readonly batchSize?: number;
}

export interface ConflictError extends BaseConvexRxError {
  readonly category: typeof ErrorCategory.CONFLICT;
  readonly documentId: string;
  readonly collectionName: string;
  readonly conflictType: 'version' | 'concurrent_edit' | 'handler_failed';
  readonly clientVersion?: number;
  readonly serverVersion?: number;
}

export interface ValidationError extends BaseConvexRxError {
  readonly category: typeof ErrorCategory.VALIDATION;
  readonly documentId?: string;
  readonly validationType: 'required_field' | 'type_mismatch' | 'constraint' | 'custom';
  readonly fieldPath: string;
  readonly expectedValue?: unknown;
  readonly actualValue?: unknown;
}

export interface StorageError extends BaseConvexRxError {
  readonly category: typeof ErrorCategory.STORAGE;
  readonly storageType: 'dexie' | 'localstorage' | 'memory' | 'custom';
  readonly operation: 'read' | 'write' | 'delete' | 'clear' | 'compact';
  readonly databaseName: string;
  readonly quota?: { used: number; available: number };
}

export interface UnknownError extends BaseConvexRxError {
  readonly category: typeof ErrorCategory.UNKNOWN;
  readonly originalErrorType?: string;
}

export type ConvexRxError =
  | InitializationError
  | SchemaError
  | NetworkError
  | ReplicationError
  | ConflictError
  | ValidationError
  | StorageError
  | UnknownError;

const baseErrorSchema = z.object({
  category: z.enum([
    ErrorCategory.INITIALIZATION,
    ErrorCategory.SCHEMA,
    ErrorCategory.NETWORK,
    ErrorCategory.REPLICATION,
    ErrorCategory.CONFLICT,
    ErrorCategory.VALIDATION,
    ErrorCategory.STORAGE,
    ErrorCategory.UNKNOWN,
  ]),
  message: z.string().min(1),
  severity: z.enum([
    ErrorSeverity.INFO,
    ErrorSeverity.WARNING,
    ErrorSeverity.ERROR,
    ErrorSeverity.FATAL,
  ]),
  recovery: z.enum([
    RecoveryStrategy.RETRY,
    RecoveryStrategy.SKIP,
    RecoveryStrategy.FALLBACK,
    RecoveryStrategy.MANUAL,
    RecoveryStrategy.NONE,
  ]),
  timestamp: z.string().datetime(),
  cause: z.unknown().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

const initializationErrorSchema = baseErrorSchema.extend({
  category: z.literal(ErrorCategory.INITIALIZATION),
  phase: z.enum(['database', 'collection', 'storage', 'plugins', 'replication']),
  databaseName: z.string().min(1),
  collectionName: z.string().optional(),
});

const schemaErrorSchema = baseErrorSchema.extend({
  category: z.literal(ErrorCategory.SCHEMA),
  schemaName: z.string().min(1),
  invalidFields: z.array(z.string()),
  documentId: z.string().optional(),
  zodIssues: z.array(z.any()).optional(),
});

const networkErrorSchema = baseErrorSchema.extend({
  category: z.literal(ErrorCategory.NETWORK),
  operation: z.enum(['pull', 'push', 'changeStream', 'query', 'mutation']),
  endpoint: z.string().optional(),
  statusCode: z.number().int().optional(),
  isOnline: z.boolean(),
  retryAttempt: z.number().int().nonnegative().optional(),
  maxRetries: z.number().int().positive().optional(),
});

const replicationErrorSchema = baseErrorSchema.extend({
  category: z.literal(ErrorCategory.REPLICATION),
  direction: z.enum(['pull', 'push', 'bidirectional']),
  collectionName: z.string().min(1),
  documentCount: z.number().int().nonnegative().optional(),
  checkpoint: z
    .object({
      id: z.string(),
      updatedTime: z.number(),
    })
    .optional(),
  batchSize: z.number().int().positive().optional(),
});

const conflictErrorSchema = baseErrorSchema.extend({
  category: z.literal(ErrorCategory.CONFLICT),
  documentId: z.string().min(1),
  collectionName: z.string().min(1),
  conflictType: z.enum(['version', 'concurrent_edit', 'handler_failed']),
  clientVersion: z.number().optional(),
  serverVersion: z.number().optional(),
});

const validationErrorSchema = baseErrorSchema.extend({
  category: z.literal(ErrorCategory.VALIDATION),
  documentId: z.string().optional(),
  validationType: z.enum(['required_field', 'type_mismatch', 'constraint', 'custom']),
  fieldPath: z.string().min(1),
  expectedValue: z.unknown().optional(),
  actualValue: z.unknown().optional(),
});

const storageErrorSchema = baseErrorSchema.extend({
  category: z.literal(ErrorCategory.STORAGE),
  storageType: z.enum(['dexie', 'localstorage', 'memory', 'custom']),
  operation: z.enum(['read', 'write', 'delete', 'clear', 'compact']),
  databaseName: z.string().min(1),
  quota: z
    .object({
      used: z.number().nonnegative(),
      available: z.number().nonnegative(),
    })
    .optional(),
});

const unknownErrorSchema = baseErrorSchema.extend({
  category: z.literal(ErrorCategory.UNKNOWN),
  originalErrorType: z.string().optional(),
});

export const convexRxErrorSchema = z.discriminatedUnion('category', [
  initializationErrorSchema,
  schemaErrorSchema,
  networkErrorSchema,
  replicationErrorSchema,
  conflictErrorSchema,
  validationErrorSchema,
  storageErrorSchema,
  unknownErrorSchema,
]);

export function createInitializationError(
  params: Omit<InitializationError, 'category' | 'timestamp'>
): InitializationError {
  const error: InitializationError = {
    category: ErrorCategory.INITIALIZATION,
    timestamp: new Date().toISOString(),
    ...params,
  };

  return initializationErrorSchema.parse(error);
}

export function createSchemaError(
  params: Omit<SchemaError, 'category' | 'timestamp'>
): SchemaError {
  const error: SchemaError = {
    category: ErrorCategory.SCHEMA,
    timestamp: new Date().toISOString(),
    ...params,
  };

  return schemaErrorSchema.parse(error);
}

export function createNetworkError(
  params: Omit<NetworkError, 'category' | 'timestamp'>
): NetworkError {
  const error: NetworkError = {
    category: ErrorCategory.NETWORK,
    timestamp: new Date().toISOString(),
    ...params,
  };

  return networkErrorSchema.parse(error);
}

export function createReplicationError(
  params: Omit<ReplicationError, 'category' | 'timestamp'>
): ReplicationError {
  const error: ReplicationError = {
    category: ErrorCategory.REPLICATION,
    timestamp: new Date().toISOString(),
    ...params,
  };

  return replicationErrorSchema.parse(error);
}

export function createConflictError(
  params: Omit<ConflictError, 'category' | 'timestamp'>
): ConflictError {
  const error: ConflictError = {
    category: ErrorCategory.CONFLICT,
    timestamp: new Date().toISOString(),
    ...params,
  };

  return conflictErrorSchema.parse(error);
}

export function createValidationError(
  params: Omit<ValidationError, 'category' | 'timestamp'>
): ValidationError {
  const error: ValidationError = {
    category: ErrorCategory.VALIDATION,
    timestamp: new Date().toISOString(),
    ...params,
  };

  return validationErrorSchema.parse(error);
}

export function createStorageError(
  params: Omit<StorageError, 'category' | 'timestamp'>
): StorageError {
  const error: StorageError = {
    category: ErrorCategory.STORAGE,
    timestamp: new Date().toISOString(),
    ...params,
  };

  return storageErrorSchema.parse(error);
}

export function createUnknownError(
  params: Omit<UnknownError, 'category' | 'timestamp'>
): UnknownError {
  const error: UnknownError = {
    category: ErrorCategory.UNKNOWN,
    timestamp: new Date().toISOString(),
    ...params,
  };

  return unknownErrorSchema.parse(error);
}

export function toConvexRxError(error: unknown): ConvexRxError {
  if (isConvexRxError(error)) {
    return error;
  }

  if (error instanceof TypeError) {
    return createNetworkError({
      message: error.message,
      severity: ErrorSeverity.ERROR,
      recovery: RecoveryStrategy.RETRY,
      operation: 'query',
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      cause: error,
    });
  }

  if (error instanceof z.ZodError) {
    const firstIssue = error.issues[0];
    return createSchemaError({
      message: `Schema validation failed: ${firstIssue?.message || 'Unknown validation error'}`,
      severity: ErrorSeverity.ERROR,
      recovery: RecoveryStrategy.SKIP,
      schemaName: 'unknown',
      invalidFields: error.issues.map((issue) => issue.path.join('.')),
      zodIssues: error.issues,
      cause: error,
    });
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('connection') ||
      message.includes('timeout')
    ) {
      return createNetworkError({
        message: error.message,
        severity: ErrorSeverity.ERROR,
        recovery: RecoveryStrategy.RETRY,
        operation: 'query',
        isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
        cause: error,
      });
    }

    return createUnknownError({
      message: error.message,
      severity: ErrorSeverity.ERROR,
      recovery: RecoveryStrategy.MANUAL,
      originalErrorType: error.constructor.name,
      cause: error,
    });
  }

  return createUnknownError({
    message: String(error),
    severity: ErrorSeverity.ERROR,
    recovery: RecoveryStrategy.MANUAL,
    cause: error,
  });
}

export function isConvexRxError(value: unknown): value is ConvexRxError {
  try {
    convexRxErrorSchema.parse(value);
    return true;
  } catch {
    return false;
  }
}

export interface ErrorHandlerConfig {
  component: string;
  enableLogging?: boolean;
  onError?: (error: ConvexRxError) => void;
  autoRetry?: boolean;
}

export class ConvexRxErrorHandler {
  private readonly logger: Logger;
  private readonly config: Required<ErrorHandlerConfig>;

  constructor(config: ErrorHandlerConfig) {
    this.config = {
      enableLogging: true,
      onError: () => {},
      autoRetry: false,
      ...config,
    };
    this.logger = getLogTapeLogger(['convex-rx', this.config.component]);
  }

  handle(error: unknown): ConvexRxError {
    const convexError = toConvexRxError(error);
    this.logError(convexError);
    this.config.onError(convexError);
    return convexError;
  }

  async handleAsync<T>(
    error: unknown,
    recovery?: () => Promise<T>
  ): Promise<{ error: ConvexRxError; recovered?: T }> {
    const convexError = this.handle(error);

    if (this.config.autoRetry && convexError.recovery === RecoveryStrategy.RETRY && recovery) {
      try {
        this.logger.info('Attempting error recovery', {
          category: convexError.category,
          recovery: convexError.recovery,
        });

        const result = await recovery();

        this.logger.info('Error recovery successful', {
          category: convexError.category,
        });

        return { error: convexError, recovered: result };
      } catch (recoveryError) {
        this.logger.error('Error recovery failed', {
          category: convexError.category,
          recoveryError,
        });
      }
    }

    return { error: convexError };
  }

  private logError(error: ConvexRxError): void {
    if (!this.config.enableLogging && error.severity !== ErrorSeverity.FATAL) {
      return;
    }

    const logData = {
      category: error.category,
      severity: error.severity,
      recovery: error.recovery,
      message: error.message,
      timestamp: error.timestamp,
      ...error.context,
    };

    switch (error.category) {
      case ErrorCategory.INITIALIZATION:
        Object.assign(logData, {
          phase: error.phase,
          databaseName: error.databaseName,
          collectionName: error.collectionName,
        });
        break;

      case ErrorCategory.SCHEMA:
        Object.assign(logData, {
          schemaName: error.schemaName,
          invalidFields: error.invalidFields,
          documentId: error.documentId,
        });
        break;

      case ErrorCategory.NETWORK:
        Object.assign(logData, {
          operation: error.operation,
          isOnline: error.isOnline,
          retryAttempt: error.retryAttempt,
          maxRetries: error.maxRetries,
        });
        break;

      case ErrorCategory.REPLICATION:
        Object.assign(logData, {
          direction: error.direction,
          collectionName: error.collectionName,
          documentCount: error.documentCount,
        });
        break;

      case ErrorCategory.CONFLICT:
        Object.assign(logData, {
          documentId: error.documentId,
          conflictType: error.conflictType,
          clientVersion: error.clientVersion,
          serverVersion: error.serverVersion,
        });
        break;

      case ErrorCategory.VALIDATION:
        Object.assign(logData, {
          validationType: error.validationType,
          fieldPath: error.fieldPath,
          expectedValue: error.expectedValue,
          actualValue: error.actualValue,
        });
        break;

      case ErrorCategory.STORAGE:
        Object.assign(logData, {
          storageType: error.storageType,
          operation: error.operation,
          quota: error.quota,
        });
        break;
    }

    switch (error.severity) {
      case ErrorSeverity.INFO:
        this.logger.info('ConvexRx error (info)', logData);
        break;
      case ErrorSeverity.WARNING:
        this.logger.warn('ConvexRx error (warning)', logData);
        break;
      case ErrorSeverity.ERROR:
        this.logger.error('ConvexRx error', logData);
        break;
      case ErrorSeverity.FATAL:
        this.logger.fatal('ConvexRx fatal error', logData);
        break;
    }
  }

  format(error: ConvexRxError): string {
    const parts = [`[${error.category.toUpperCase()}]`, error.message];

    if (error.recovery !== RecoveryStrategy.NONE) {
      parts.push(`(Recovery: ${error.recovery})`);
    }

    return parts.join(' ');
  }
}

export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  handler: ConvexRxErrorHandler
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw handler.handle(error);
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    retryDelay?: number;
    handler: ConvexRxErrorHandler;
  }
): Promise<T> {
  const { maxRetries = 3, retryDelay = 1000, handler } = options;
  let lastError: ConvexRxError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = handler.handle(error);

      if (lastError.recovery === RecoveryStrategy.RETRY && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError;
}
