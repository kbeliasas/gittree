import { z } from 'zod';

import { CommitDetails, CommitQuery, DiffQuery, FileDiff, RepoId, Sha, type CompareWith } from '../../shared/api.ts';
import type { App } from '../app.ts';
import { readCombined, readCommitDetails, readFileDiff, type Combined, type CommitMeta } from '../commits/commit.ts';
import type { GitRunner } from '../git/runner.ts';
import { LruCache } from '../lru.ts';
import type { RepoRegistry } from '../repos/registry.ts';
import type { Repo } from '../repos/repo.ts';
import { findRepo } from './repos.ts';
import { clientGoneSignal } from './signal.ts';

const CommitParams = z.object({ id: RepoId, sha: Sha });

/**
 * Commits are immutable, so details and diffs are cached by hash (PLAN §5),
 * independent of the refs snapshot.
 */
export function commitRoutes(app: App, options: { git: GitRunner; registry: RepoRegistry }): void {
  const { git, registry } = options;
  const details = new LruCache<string, CommitDetails>(256);
  const combined = new LruCache<string, Combined>(16);
  const diffs = new LruCache<string, FileDiff>(48);

  const loadCombined = async (repo: Repo, meta: Pick<CommitMeta, 'sha' | 'parents'>, ws: boolean, signal: AbortSignal) => {
    const key = `${repo.id}:${meta.sha}:${ws ? 'w' : ''}`;
    const cached = combined.get(key);
    if (cached) return cached;
    const value = await readCombined(git, repo, meta, ws, signal);
    combined.set(key, value);
    return value;
  };

  const loadDetails = async (repo: Repo, sha: string, compare: CompareWith, signal: AbortSignal) => {
    const key = `${repo.id}:${sha}:${compare}`;
    const cached = details.get(key);
    if (cached) return cached;
    const value = await readCommitDetails(git, repo, sha, compare, signal, (meta) => loadCombined(repo, meta, false, signal));
    details.set(key, value);
    return value;
  };

  app.get(
    '/api/repos/:id/commits/:sha',
    { schema: { params: CommitParams, querystring: CommitQuery, response: { 200: CommitDetails } } },
    async (request, reply) => {
      const repo = findRepo(registry, request.params.id);
      return loadDetails(repo, request.params.sha, request.query.parent, clientGoneSignal(reply.raw));
    },
  );

  app.get(
    '/api/repos/:id/diff',
    { schema: { params: z.object({ id: RepoId }), querystring: DiffQuery, response: { 200: FileDiff } } },
    async (request, reply) => {
      const repo = findRepo(registry, request.params.id);
      const { sha, parent, path } = request.query;
      const ws = request.query.ws === '1';
      const key = `${repo.id}:${sha}:${parent}:${ws ? 'w' : ''}:${path}`;
      const cached = diffs.get(key);
      if (cached) return cached;

      const signal = clientGoneSignal(reply.raw);
      const commit = await loadDetails(repo, sha, parent, signal);
      const diff = await readFileDiff(git, repo, commit, {
        compare: parent,
        path,
        ignoreWhitespace: ws,
        combined: () => loadCombined(repo, commit, ws, signal),
        signal,
      });
      diffs.set(key, diff);
      return diff;
    },
  );
}
