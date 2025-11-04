import {
  type Logger,
  configure,
  getConsoleSink,
  getLogger as getLogTapeLogger,
} from '@logtape/logtape';

let isConfigured = false;

export async function configureLogger(enableLogging = false): Promise<void> {
  if (isConfigured) return;

  await configure({
    sinks: {
      console: getConsoleSink(),
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
