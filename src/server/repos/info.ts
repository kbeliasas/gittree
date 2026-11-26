import type { RepoInfo, RepoSummary } from '../../shared/api.ts';
import type { GitRunner } from '../git/runner.ts';
import type { Repo } from './repo.ts';

export function toSummary(repo: Repo): RepoSummary {
  return { id: repo.id, name: repo.name, path: repo.path, bare: repo.bare };
}

/** HEAD, shallow state and the size of the graph gittree will draw. */
export async function readRepoInfo(git: GitRunner, repo: Repo, signal?: AbortSignal): Promise<RepoInfo> {
  const cwd = repo.path;
  const [symbolic, verified, shallow] = await Promise.all([
    // exit 1: detached HEAD
    git.run('symbolic-ref', { cwd, signal, args: ['-q', 'HEAD'], okExitCodes: [0, 1] }),
    // exit 1: unborn HEAD (no commits yet)
    git.run('rev-parse', { cwd, signal, args: ['-q', '--verify'], revs: ['HEAD^{commit}'], okExitCodes: [0, 1] }),
    git.text('rev-parse', { cwd, signal, args: ['--is-shallow-repository'] }),
  ]);

  const headRef = symbolic.exitCode === 0 ? symbolic.stdout.toString('utf8').trim() : null;
  const branch = headRef?.startsWith('refs/heads/') ? headRef.slice('refs/heads/'.length) : headRef;
  const sha = verified.exitCode === 0 ? verified.stdout.toString('utf8').trim() : null;

  // Same revisions the history graph will show.
  const count = await git.text('rev-list', {
    cwd,
    signal,
    args: ['--count', '--branches', '--remotes', '--tags'],
    revs: sha ? ['HEAD'] : [],
  });

  return {
    ...toSummary(repo),
    shallow: shallow.trim() === 'true',
    head: { sha, branch },
    commitCount: Number.parseInt(count.trim(), 10),
  };
}
