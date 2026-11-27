import type { RepoInfo, RepoSummary } from '../../shared/api.ts';
import type { GitRunner } from '../git/runner.ts';
import { readHead } from './head.ts';
import type { Repo } from './repo.ts';
import { readWebLink } from './web-link.ts';

export function toSummary(repo: Repo): RepoSummary {
  return { id: repo.id, name: repo.name, path: repo.path, bare: repo.bare };
}

/** HEAD, shallow state and the size of the graph gittree will draw. */
export async function readRepoInfo(git: GitRunner, repo: Repo, signal?: AbortSignal): Promise<RepoInfo> {
  const cwd = repo.path;
  const [head, shallow, web] = await Promise.all([
    readHead(git, repo, signal),
    git.text('rev-parse', { cwd, signal, args: ['--is-shallow-repository'] }),
    readWebLink(git, repo, signal),
  ]);

  // Same revisions the history graph will show.
  const count = await git.text('rev-list', {
    cwd,
    signal,
    args: ['--count', '--branches', '--remotes', '--tags'],
    revs: head.sha ? ['HEAD'] : [],
  });

  return {
    ...toSummary(repo),
    shallow: shallow.trim() === 'true',
    head,
    commitCount: Number.parseInt(count.trim(), 10),
    web,
  };
}
