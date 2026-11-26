import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

import { isApiPath, pathOf } from './security/guard.ts';
import { messagePage } from './security/pages.ts';

/**
 * Serves the built web app from `webRoot`: hashed files under /assets are
 * cached forever, every other GET without a file extension gets index.html so
 * deep links into the app work. Unknown /api paths stay JSON 404s.
 */
export async function registerWeb(app: FastifyInstance, options: { webRoot: string | null }): Promise<void> {
  const { webRoot } = options;

  if (webRoot) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      index: 'index.html',
      setHeaders(reply, path) {
        const hashed = /[\\/]assets[\\/]/.test(path);
        reply.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    const path = pathOf(request);
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    if (isApiPath(path) || !isRead) {
      return reply
        .code(404)
        .header('Cache-Control', 'no-store')
        .send({ error: 'not_found', message: `No route for ${request.method} ${path}.` });
    }
    if (/\.[a-z0-9]+$/i.test(path)) {
      return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
    }
    if (!webRoot) {
      return reply
        .code(503)
        .type('text/html; charset=utf-8')
        .send(
          messagePage(
            'The gittree web app isn’t built',
            '<p>Run <code>pnpm build</code> in the gittree folder, then start gittree again.</p>',
          ),
        );
    }
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });
}
