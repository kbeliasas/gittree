import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { messagePage, SIGN_IN_HINT } from './pages.ts';
import type { Session } from './session.ts';

export interface GuardOptions {
  session: Session;
  /** Port the server is reachable on (known only after listen when it was 0). */
  port: () => number;
  /** Additional Origin values to accept, e.g. the Vite dev server. */
  extraOrigins?: readonly string[];
}

export const AUTH_PATH = '/auth';

/** Cookie names aren't port-scoped, so two gittree instances must not share one. */
export function cookieNameFor(port: number): string {
  return `gittree_${port}`;
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Keeps other web pages away from your repositories. Runs before every route:
 *  1. Host must be 127.0.0.1:<port> or localhost:<port> — defeats DNS rebinding.
 *  2. Origin, when sent, must be this server (or the dev server) — blocks cross-origin writes.
 *  3. Sec-Fetch-Site must not be cross-site; same-site (another localhost port) only
 *     for top-level navigations — other local servers can't call the API.
 *  4. A valid session cookie, except on /auth where the one-time token is swapped for it.
 * No CORS headers are ever sent, so other origins can't read responses either.
 */
export function installGuard(app: FastifyInstance, options: GuardOptions): void {
  app.addHook('onRequest', async (request, reply) => {
    setSecurityHeaders(reply);
    // Repository data stays out of the browser's disk cache.
    if (isApiPath(pathOf(request))) reply.header('Cache-Control', 'no-store');

    const port = options.port();
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const host = request.headers.host?.toLowerCase();
    if (host === undefined || !hosts.includes(host)) {
      return deny(request, reply, 403, 'bad_host', 'Unexpected Host header.');
    }

    const origin = request.headers.origin;
    if (origin !== undefined) {
      const origins = [...hosts.map((h) => `http://${h}`), ...(options.extraOrigins ?? [])];
      if (!origins.includes(origin)) return deny(request, reply, 403, 'bad_origin', 'Cross-origin requests are not allowed.');
    }

    const site = request.headers['sec-fetch-site'];
    const navigation =
      request.headers['sec-fetch-mode'] === 'navigate' && (request.method === 'GET' || request.method === 'HEAD');
    if (site === 'cross-site' || (site === 'same-site' && !navigation)) {
      return deny(request, reply, 403, 'cross_site', 'Cross-site requests are not allowed.');
    }

    if (pathOf(request) === AUTH_PATH) return; // the auth route checks the token itself

    if (!options.session.isValidCookie(request.cookies[cookieNameFor(port)])) {
      return deny(request, reply, 401, 'unauthorized', 'Open the link printed by gittree in your terminal.');
    }
  });
}

export function pathOf(request: FastifyRequest): string {
  const query = request.url.indexOf('?');
  return query === -1 ? request.url : request.url.slice(0, query);
}

export function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

function setSecurityHeaders(reply: FastifyReply): void {
  reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
}

function deny(request: FastifyRequest, reply: FastifyReply, status: 401 | 403, error: string, message: string) {
  reply.code(status).header('Cache-Control', 'no-store');
  if (isApiPath(pathOf(request)) || !acceptsHtml(request)) {
    return reply.send({ error, message });
  }
  const title = status === 401 ? 'This tab isn’t signed in to gittree' : 'Request blocked';
  return reply.type('text/html; charset=utf-8').send(messagePage(title, status === 401 ? SIGN_IN_HINT : `<p>${message}</p>`));
}

function acceptsHtml(request: FastifyRequest): boolean {
  return (request.headers.accept ?? '').includes('text/html');
}
