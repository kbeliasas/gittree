import { Readable } from 'node:stream';

import { SearchQuery, TreePayload, TreeQuery, type SearchEvent } from '../../shared/api.ts';
import type { App } from '../app.ts';
import { HttpError } from '../errors.ts';
import { GitError } from '../git/errors.ts';
import type { GitRunner } from '../git/runner.ts';
import { readSnapshot } from '../graph/graph.ts';
import { LruCache } from '../lru.ts';
import type { RepoRegistry } from '../repos/registry.ts';
import { startSearch } from '../search/search.ts';
import { findRepo, RepoParams } from './repos.ts';
import { clientGoneSignal } from './signal.ts';

interface Finished {
  matches: string[];
  total: number;
}

/**
 * PLAN §8 server search, streamed as NDJSON (one SearchEvent per line) while git works; the client
 * stops it by going away. Finished searches are cached per refs snapshot, and so are file lists.
 */
export function searchRoutes(app: App, options: { git: GitRunner; registry: RepoRegistry }): void {
  const { git, registry } = options;
  const finished = new LruCache<string, Finished>(32);
  const trees = new LruCache<string, TreePayload>(4);

  app.get('/api/repos/:id/search', { schema: { params: RepoParams, querystring: SearchQuery } }, async (request, reply) => {
    const repo = findRepo(registry, request.params.id);
    const { kind, value, order, limit } = request.query;
    const ignoreCase = kind === 'regex' && request.query.flags === 'i';
    const signal = clientGoneSignal(reply.raw);
    const snapshot = await readSnapshot(git, repo, signal);
    const key = [repo.id, snapshot.id, order, limit, kind, ignoreCase ? 'i' : '', value].join('\0');

    const cached = finished.get(key);
    const events = cached
      ? replay(cached)
      : remember((await startSearch(git, repo, snapshot, { kind, value, ignoreCase }, { order, limit }, signal)).events, (result) =>
          finished.set(key, result),
        );
    reply.header('content-type', 'application/x-ndjson; charset=utf-8').header('cache-control', 'no-store');
    return reply.send(Readable.from(lines(events), { objectMode: false }));
  });

  app.get(
    '/api/repos/:id/tree',
    { schema: { params: RepoParams, querystring: TreeQuery, response: { 200: TreePayload } } },
    async (request, reply) => {
      const repo = findRepo(registry, request.params.id);
      const { at } = request.query;
      const key = `${repo.id}:${at}`;
      const cached = trees.get(key);
      if (cached) return cached;
      let output: string;
      try {
        output = await git.text('ls-tree', { cwd: repo.path, signal: clientGoneSignal(reply.raw), args: ['-r', '-z', '--name-only'], revs: [at] });
      } catch (error) {
        if (error instanceof GitError && error.code === 'GIT_FAILED') throw new HttpError(404, 'commit_not_found', `No commit ${at} in this repository.`);
        throw error;
      }
      const payload: TreePayload = { at, paths: output.split('\0').filter((path) => path !== '') };
      trees.set(key, payload);
      return payload;
    },
  );
}

async function* lines(events: AsyncIterable<SearchEvent>): AsyncGenerator<string> {
  for await (const event of events) yield `${JSON.stringify(event)}\n`;
}

async function* replay({ matches, total }: Finished): AsyncGenerator<SearchEvent> {
  yield { type: 'progress', searched: total, total, matches };
  yield { type: 'done', searched: total, total };
}

/** Passes the events on, and hands the matches over once the search finished. */
async function* remember(events: AsyncIterable<SearchEvent>, save: (result: Finished) => void): AsyncGenerator<SearchEvent> {
  const matches: string[] = [];
  for await (const event of events) {
    if (event.type === 'progress') matches.push(...event.matches);
    if (event.type === 'done') save({ matches, total: event.total });
    yield event;
  }
}
