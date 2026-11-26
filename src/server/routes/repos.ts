import { z } from 'zod';

import { RepoId, RepoInfo, ReposResponse } from '../../shared/api.ts';
import type { App } from '../app.ts';
import { HttpError } from '../errors.ts';
import type { GitRunner } from '../git/runner.ts';
import { readRepoInfo, toSummary } from '../repos/info.ts';
import type { RepoRegistry } from '../repos/registry.ts';
import type { Repo } from '../repos/repo.ts';
import { clientGoneSignal } from './signal.ts';

export const RepoParams = z.object({ id: RepoId });

/** The registered repository with this id, or a 404. */
export function findRepo(registry: RepoRegistry, id: string): Repo {
  const repo = registry.get(id);
  if (!repo) throw new HttpError(404, 'repo_not_found', `No repository with id ${id}.`);
  return repo;
}

export function repoRoutes(app: App, options: { git: GitRunner; registry: RepoRegistry }): void {
  const { git, registry } = options;

  app.get('/api/repos', { schema: { response: { 200: ReposResponse } } }, async () => ({
    repos: registry.list().map(toSummary),
  }));

  app.get('/api/repos/:id', { schema: { params: RepoParams, response: { 200: RepoInfo } } }, async (request, reply) =>
    readRepoInfo(git, findRepo(registry, request.params.id), clientGoneSignal(reply.raw)),
  );
}
