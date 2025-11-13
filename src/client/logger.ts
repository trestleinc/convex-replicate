import {
  type Logger,
  type LogRecord,
  configure,
  getConsoleSink,
  getLogger as getLogTapeLogger,
} from '@logtape/logtape';

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
