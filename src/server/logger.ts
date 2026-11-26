import type { FastifyBaseLogger } from 'fastify';

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
type Level = (typeof LEVELS)[number];

/**
 * A small human-readable stand-in for Fastify's JSON logger: one line per
 * message on stderr, errors with their message. Requests are logged separately
 * (see logRequests in app.ts) so sign-in tokens can be redacted.
 */
export function consoleLogger(level: Level = 'warn'): FastifyBaseLogger {
  const threshold = LEVELS.indexOf(level);
  const method = (name: Level) => {
    if (LEVELS.indexOf(name) < threshold) return () => {};
    return (...args: unknown[]) => {
      const [first, second] = args;
      const message = typeof first === 'string' ? first : typeof second === 'string' ? second : '';
      const error = first instanceof Error ? first : errorIn(first);
      const detail = error ? `${message ? ': ' : ''}${error.message}` : '';
      process.stderr.write(`gittree ${name}: ${message}${detail}\n`);
    };
  };
  const logger: FastifyBaseLogger = {
    level,
    trace: method('trace'),
    debug: method('debug'),
    info: method('info'),
    warn: method('warn'),
    error: method('error'),
    fatal: method('fatal'),
    silent: () => {},
    child: () => logger,
  };
  return logger;
}

function errorIn(value: unknown): Error | undefined {
  if (typeof value === 'object' && value !== null && 'err' in value && value.err instanceof Error) return value.err;
  return undefined;
}

/** Hides the one-time sign-in token in anything that gets logged. */
export function redactToken(url: string): string {
  return url.replace(/([?&]token=)[^&]*/g, '$1[redacted]');
}
