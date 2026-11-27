import { GraphPayload, GraphQuery, MessagesPayload, MessagesQuery } from '../../shared/api.ts';
import type { App } from '../app.ts';
import { HttpError } from '../errors.ts';
import type { GitRunner } from '../git/runner.ts';
import { decodeCursor, readGraph, readMessages, readSnapshot } from '../graph/graph.ts';
import { LruCache } from '../lru.ts';
import type { RepoRegistry } from '../repos/registry.ts';
import { findRepo, RepoParams } from './repos.ts';
import { clientGoneSignal } from './signal.ts';

/** Pages kept in memory. A page is recomputed only when the refs snapshot changes. */
const CACHED_PAGES = 8;
/** Message sets kept in memory, also per refs snapshot. */
const CACHED_MESSAGES = 4;

export function graphRoutes(app: App, options: { git: GitRunner; registry: RepoRegistry }): void {
  const { git, registry } = options;
  const cache = new LruCache<string, GraphPayload>(CACHED_PAGES);
  const messages = new LruCache<string, MessagesPayload>(CACHED_MESSAGES);

  app.get(
    '/api/repos/:id/graph',
    { schema: { params: RepoParams, querystring: GraphQuery, response: { 200: GraphPayload } } },
    async (request, reply) => {
      const repo = findRepo(registry, request.params.id);
      const { order, limit, cursor } = request.query;
      const signal = clientGoneSignal(reply.raw);
      const snapshot = await readSnapshot(git, repo, signal);

      let offset = 0;
      if (cursor !== undefined) {
        const decoded = decodeCursor(cursor);
        if (!decoded || decoded.order !== order) {
          throw new HttpError(400, 'bad_cursor', 'The cursor does not belong to this graph order.');
        }
        if (decoded.snapshot !== snapshot.id) {
          throw new HttpError(409, 'snapshot_changed', 'The history changed since the first page; load the graph again.');
        }
        offset = decoded.offset;
      }

      const key = `${repo.id}:${snapshot.id}:${order}:${offset}:${limit}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const payload = await readGraph(git, repo, snapshot, { order, offset, limit, signal });
      cache.set(key, payload);
      return payload;
    },
  );

  app.get(
    '/api/repos/:id/messages',
    { schema: { params: RepoParams, querystring: MessagesQuery, response: { 200: MessagesPayload } } },
    async (request, reply) => {
      const repo = findRepo(registry, request.params.id);
      const { order, limit } = request.query;
      const signal = clientGoneSignal(reply.raw);
      const snapshot = await readSnapshot(git, repo, signal);
      const key = `${repo.id}:${snapshot.id}:${order}:${limit}`;
      const cached = messages.get(key);
      if (cached) return cached;
      const payload = await readMessages(git, repo, snapshot, { order, limit, signal });
      messages.set(key, payload);
      return payload;
    },
  );
}
