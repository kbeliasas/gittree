import type { RateLimitPluginOptions } from '@fastify/rate-limit';

import { HttpError } from '../errors.ts';
import { isApiPath, pathOf } from './guard.ts';

export interface ApiRateLimit {
  /** Requests allowed per window. */
  max: number;
  timeWindowMs: number;
}

/**
 * Far above what the web app sends: a page load is a handful of requests, and
 * stepping through commits with the keyboard a few dozen a second at most.
 */
export const API_RATE_LIMIT: ApiRateLimit = { max: 1000, timeWindowMs: 10_000 };

/**
 * Options for @fastify/rate-limit, which caps /api requests so a runaway client
 * can't keep git busy without end.
 *
 * The plugin counts requests in an onRequest hook on each route, and Fastify
 * runs those after the app-wide ones, so the guard goes first: requests it
 * turns away (other pages, no session cookie) never count and can't use up the
 * quota. Every client is 127.0.0.1, so all API requests share one budget.
 */
export function rateLimitOptions(limit: ApiRateLimit): RateLimitPluginOptions {
  const seconds = limit.timeWindowMs / 1000;
  return {
    max: limit.max,
    timeWindow: limit.timeWindowMs,
    // The web app and /auth aren't limited.
    allowList: (request) => !isApiPath(pathOf(request)),
    errorResponseBuilder: (_request, context) =>
      new HttpError(
        context.statusCode,
        'rate_limited',
        `Too many requests (more than ${context.max} in ${seconds} s). Try again in ${context.after}.`,
      ),
  };
}
