import type { HeadInfo } from '../../shared/api.ts';
import type { GitRunner } from '../git/runner.ts';
import type { Repo } from './repo.ts';

/** Where HEAD points: a branch (possibly without commits yet) or, detached, just a commit. */
export async function readHead(git: GitRunner, repo: Repo, signal?: AbortSignal): Promise<HeadInfo> {
  const cwd = repo.path;
  const [symbolic, verified] = await Promise.all([
    // exit 1: detached HEAD
    git.run('symbolic-ref', { cwd, signal, args: ['-q', 'HEAD'], okExitCodes: [0, 1] }),
    // exit 1: unborn HEAD (no commits yet)
    git.run('rev-parse', { cwd, signal, args: ['-q', '--verify'], revs: ['HEAD^{commit}'], okExitCodes: [0, 1] }),
  ]);

  const headRef = symbolic.exitCode === 0 ? symbolic.stdout.toString('utf8').trim() : null;
  const branch = headRef?.startsWith('refs/heads/') ? headRef.slice('refs/heads/'.length) : headRef;
  const sha = verified.exitCode === 0 ? verified.stdout.toString('utf8').trim() : null;
  return { sha, branch };
}
