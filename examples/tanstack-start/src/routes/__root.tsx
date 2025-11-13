import { TanStackDevtools } from '@tanstack/react-devtools';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Scripts } from '@tanstack/react-router';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { configure, getConsoleSink, type LogRecord } from '@logtape/logtape';
import { ConvexRxErrorBoundary } from '../components/ErrorBoundary';

import appCss from '../styles.css?url';

try {
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
    loggers: [{ category: ['convex-replicate'], lowestLevel: 'debug', sinks: ['console'] }],
  });
} catch {
  // LogTape already configured during HMR - this is expected
}

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Replicate - Tanstack',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ConvexRxErrorBoundary>
          {children}
          <TanStackDevtools
            config={{
              position: 'bottom-right',
            }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        </ConvexRxErrorBoundary>
        <Scripts />
      </body>
    </html>
  );
}
