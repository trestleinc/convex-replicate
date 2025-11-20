import {
  type Logger,
  type LogRecord,
  configure,
  getConsoleSink,
  getLogger as getLogTapeLogger,
} from '@logtape/logtape';
import { Logger as EffectLogger, Layer, ConfigProvider, List, HashMap } from 'effect';

let isConfigured = false;

export async function configureLogger(enableLogging = false): Promise<void> {
  if (isConfigured) return;

  await configure({
    sinks: {
      console: getConsoleSink({
        formatter(record: LogRecord): readonly unknown[] {
          // Build message with embedded values using %o for object expansion
          let msg = '';
          const values: unknown[] = [];
          for (let i = 0; i < record.message.length; i++) {
            if (i % 2 === 0) msg += record.message[i];
            else {
              msg += '%o';
              values.push(record.message[i]);
            }
          }

          // Add properties if they exist
          const hasProperties = Object.keys(record.properties).length > 0;
          const propsMsg = hasProperties ? ' | Props: %o' : '';

          return [
            `${record.level.toUpperCase()} %c${record.category.join('·')}%c ${msg}${propsMsg}`,
            'color: gray;',
            'color: default;',
            ...values,
            ...(hasProperties ? [record.properties] : []),
          ];
        },
      }),
    },
    loggers: [
      {
        category: ['convex-replicate'],
        lowestLevel: enableLogging ? 'debug' : 'warning',
        sinks: ['console'],
      },
    ],
  });

  isConfigured = true;
}

export function getLogger(category: string[]): Logger {
  return getLogTapeLogger(['convex-replicate', ...category]);
}

// Configure Effect.Logger to forward to LogTape
export const configureEffectLogger = () => {
  const logtape = getLogTapeLogger(['convex-replicate']);

  return EffectLogger.replace(
    EffectLogger.defaultLogger,
    EffectLogger.make(({ logLevel, message, cause, spans, annotations }) => {
      // Convert annotations HashMap to plain object
      const annotationsObj = Object.fromEntries(HashMap.toEntries(annotations));

      // Convert spans List to array and extract labels
      const spansArray = List.toArray(spans).map((s) => s.label);

      const meta = {
        ...annotationsObj,
        spans: spansArray,
        ...(cause ? { cause } : {}),
      };

      // Convert message to string (it's of type unknown)
      const messageStr = String(message);

      // Map Effect log levels to LogTape levels
      switch (logLevel._tag) {
        case 'Fatal':
        case 'Error':
          logtape.error(messageStr, meta);
          break;
        case 'Warning':
          logtape.warn(messageStr, meta);
          break;
        case 'Info':
          logtape.info(messageStr, meta);
          break;
        case 'Debug':
        case 'Trace':
          logtape.debug(messageStr, meta);
          break;
      }
    })
  );
};

// Initialize once at app startup
export const LoggerLayer = Layer.setConfigProvider(
  ConfigProvider.fromJson({ logLevel: 'info' })
).pipe(Layer.provide(configureEffectLogger()));
