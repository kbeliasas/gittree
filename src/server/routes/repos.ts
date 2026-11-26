import { z } from 'zod';

import { RepoId, RepoInfo, ReposResponse } from '../../shared/api.ts';
import type { App } from '../app.ts';
import { HttpError } from '../errors.ts';
import type { GitRunner } from '../git/runner.ts';
import { readRepoInfo, toSummary } from '../repos/info.ts';
import type { RepoRegistry } from '../repos/registry.ts';
import { clientGoneSignal } from './signal.ts';

export function repoRoutes(app: App, options: { git: GitRunner; registry: RepoRegistry }): void {
  const { git, registry } = options;

  app.get('/api/repos', { schema: { response: { 200: ReposResponse } } }, async () => ({
    repos: registry.list().map(toSummary),
  }));

  app.get(
    '/api/repos/:id',
    { schema: { params: z.object({ id: RepoId }), response: { 200: RepoInfo } } },
    async (request, reply) => {
      const repo = registry.get(request.params.id);
      if (!repo) throw new HttpError(404, 'repo_not_found', `No repository with id ${request.params.id}.`);
      return readRepoInfo(git, repo, clientGoneSignal(reply.raw));
    },
  );
}
