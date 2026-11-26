import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, inject, it } from 'vitest';

import { fixtureGit } from '../../../test/fixtures/build.ts';
import { GitRunner } from '../git/runner.ts';
import { readRepoInfo } from './info.ts';
import { RepoError, repoIdFor, resolveRepo } from './repo.ts';

const fixtures = inject('fixtures');
const { repos } = fixtures;
const git = new GitRunner();

describe('resolveRepo', () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'gittree-not-a-repo-')));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it('resolves a work tree to its root and a stable id', async () => {
    const repo = await resolveRepo(git, repos.linear.dir);
    expect(repo).toEqual({
      id: repoIdFor(repos.linear.dir),
      name: 'linear',
      path: repos.linear.dir,
      gitDir: join(repos.linear.dir, '.git'),
      bare: false,
    });
    expect(repo.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('resolves a subfolder and the .git folder to the same repository', async () => {
    const root = await resolveRepo(git, repos.linear.dir);
    expect((await resolveRepo(git, join(repos.linear.dir, 'src'))).id).toBe(root.id);
    expect((await resolveRepo(git, join(repos.linear.dir, '.git'))).id).toBe(root.id);
  });

  it('treats a linked worktree as its own repository view', async () => {
    const repo = await resolveRepo(git, repos.worktreeLinked.dir);
    expect(repo.path).toBe(repos.worktreeLinked.dir);
    expect(repo.gitDir).toBe(join(repos.worktree.dir, '.git', 'worktrees', 'worktree-linked'));
    expect(repo.bare).toBe(false);
  });

  it('resolves bare repositories', async () => {
    const repo = await resolveRepo(git, repos.branchesOrigin.dir);
    expect(repo).toMatchObject({ name: 'branches-origin', path: repos.branchesOrigin.dir, bare: true });
  });

  it('explains paths that are not repositories', async () => {
    await expect(resolveRepo(git, scratch)).rejects.toMatchObject({ code: 'NOT_A_REPO' });
    await expect(resolveRepo(git, join(scratch, 'missing'))).rejects.toMatchObject({ code: 'PATH_NOT_FOUND' });
    const file = join(scratch, 'file.txt');
    writeFileSync(file, 'x');
    await expect(resolveRepo(git, file)).rejects.toBeInstanceOf(RepoError);
    await expect(resolveRepo(git, file)).rejects.toMatchObject({ code: 'NOT_A_DIRECTORY' });
  });
});

describe('readRepoInfo', () => {
  const info = async (dir: string) => readRepoInfo(git, await resolveRepo(git, dir));
  const graphSize = (dir: string, head = true) =>
    Number(fixtureGit(fixtures, dir, ['rev-list', '--count', '--branches', '--remotes', '--tags', ...(head ? ['HEAD'] : [])]));

  it('reports the checked-out branch and the size of the graph', async () => {
    expect(await info(repos.linear.dir)).toMatchObject({
      head: { branch: 'main', sha: repos.linear.shas.head },
      commitCount: 6,
      shallow: false,
    });
    expect((await info(repos.merges.dir)).commitCount).toBe(graphSize(repos.merges.dir));
    // includes commits only reachable from remote-tracking branches (origin/hotfix/typo)
    expect((await info(repos.branches.dir)).commitCount).toBe(graphSize(repos.branches.dir));
  });

  it('handles detached HEAD, unborn HEAD and shallow clones', async () => {
    expect((await info(repos.detached.dir)).head).toEqual({ branch: null, sha: repos.detached.shas['detached-at'] });
    expect(await info(repos.empty.dir)).toMatchObject({ head: { branch: 'main', sha: null }, commitCount: 0 });
    expect(await info(repos.shallow.dir)).toMatchObject({ shallow: true, head: { branch: 'main' } });
  });

  it('works for bare repositories', async () => {
    const bare = await info(repos.branchesOrigin.dir);
    expect(bare).toMatchObject({ bare: true, head: { branch: 'main' } });
    expect(bare.commitCount).toBe(graphSize(repos.branchesOrigin.dir));
  });
});
