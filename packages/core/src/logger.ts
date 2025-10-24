import { type Logger, configure, getConsoleSink, getLogger } from '@logtape/logtape';

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

export function getConvexReplicateLogger(category: string[]): Logger {
  return getLogger(['convex-replicate', ...category]);
}
