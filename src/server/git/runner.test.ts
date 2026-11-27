import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { GitError } from './errors.ts';
import { assertAllowed, READ_SUBCOMMANDS, type ReadSubcommand } from './policy.ts';
import { buildArgs, GitRunner } from './runner.ts';

const fixtures = inject('fixtures');
const { linear, files } = fixtures.repos;

/** Asserts that `fn` throws (or rejects with) a GitError with the given code. */
async function expectGitError(fn: () => unknown, code: GitError['code']): Promise<GitError> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GitError);
    expect((error as GitError).code).toBe(code);
    return error as GitError;
  }
  throw new Error(`expected a ${code} GitError`);
}

const parts = (args: string[] = [], revs: string[] = [], paths: string[] = []) => ({ args, revs, paths });

describe('allowlist', () => {
  it('is exactly the read commands from PLAN.md', () => {
    expect([...READ_SUBCOMMANDS].sort()).toEqual(
      [
        'blame',
        'cat-file',
        'cherry',
        'config',
        'diff',
        'diff-tree',
        'for-each-ref',
        'log',
        'ls-tree',
        'rev-list',
        'rev-parse',
        'show',
        'symbolic-ref',
        'version',
      ].sort(),
    );
  });

  it.each([
    'commit',
    'checkout',
    'switch',
    'reset',
    'merge',
    'rebase',
    'push',
    'pull',
    'branch',
    'tag',
    'update-ref',
    'stash',
    'worktree',
    'remote',
    'gc',
    'prune',
    'repack',
    'clone',
    'init',
    'apply',
    'notes',
    '--exec-path',
    '-c',
  ])('refuses git %s', async (sub) => {
    await expectGitError(() => assertAllowed(sub, parts(), { allowWrite: false }), 'GIT_DISALLOWED');
  });

  it('only allows fetch through the write path, with fixed flags', async () => {
    await expectGitError(() => assertAllowed('fetch', parts(['--all']), { allowWrite: false }), 'GIT_DISALLOWED');
    expect(() => assertAllowed('fetch', parts(['--all', '--prune', '--progress']), { allowWrite: true })).not.toThrow();
    await expectGitError(
      () => assertAllowed('fetch', parts(['--upload-pack=touch /tmp/x']), { allowWrite: true }),
      'GIT_DISALLOWED',
    );
    await expectGitError(() => assertAllowed('fetch', parts([], ['origin']), { allowWrite: true }), 'GIT_DISALLOWED');
  });

  it.each(['--output=/tmp/x', '--outp=/tmp/x', '--output', '--ext-diff', '--no-index', '--no-ind'])(
    'refuses the option %s',
    async (option) => {
      await expectGitError(() => assertAllowed('log', parts([option]), { allowWrite: false }), 'GIT_DISALLOWED');
    },
  );

  it('allows options that merely share a prefix', () => {
    expect(() =>
      assertAllowed('diff', parts(['--output-indicator-new=+', '--no-ext-diff', '-o']), { allowWrite: false }),
    ).not.toThrow();
  });

  it.each(['', '-x', '--all', '--output=/tmp/x', 'a\nb', 'a\0b'])('refuses the revision %j', async (rev) => {
    await expectGitError(() => assertAllowed('log', parts([], [rev]), { allowWrite: false }), 'GIT_DISALLOWED');
  });

  it('accepts ordinary revisions and paths that start with a dash', () => {
    expect(() =>
      assertAllowed('log', parts([], ['HEAD~1', 'main^{commit}', 'v1.0.0', 'origin/feature/x'], ['-dash.md']), {
        allowWrite: false,
      }),
    ).not.toThrow();
  });

  it.each(['', 'a\0b'])('refuses the path %j', async (path) => {
    await expectGitError(() => assertAllowed('log', parts([], [], [path]), { allowWrite: false }), 'GIT_DISALLOWED');
  });

  it.each([
    [['--get', 'user.name'], true],
    [['--get-all', 'remote.origin.url'], true],
    [['--get-regexp', '^remote\\.', 'url'], true],
    [['--type=bool', '--get', 'core.bare'], true],
    [['user.name', 'Mallory'], false],
    [['--unset', 'user.name'], false],
    [['--get', '--add', 'a.b', 'c'], false],
    [['--get', 'a.b', 'c', 'd'], false],
    [['--edit'], false],
    [['-e'], false],
  ] as const)('config %j allowed: %s', async (args, allowed) => {
    const check = () => assertAllowed('config', parts([...args]), { allowWrite: false });
    if (allowed) expect(check).not.toThrow();
    else await expectGitError(check, 'GIT_DISALLOWED');
  });

  it.each([
    [['-q', 'HEAD'], [], true],
    [['--short'], ['HEAD'], true],
    [['HEAD', 'refs/heads/x'], [], false],
    [['HEAD'], ['refs/heads/x'], false],
    [['-d', 'HEAD'], [], false],
    [['-m', 'why', 'HEAD'], [], false],
  ] as const)('symbolic-ref %j %j allowed: %s', async (args, revs, allowed) => {
    const check = () => assertAllowed('symbolic-ref', parts([...args], [...revs]), { allowWrite: false });
    if (allowed) expect(check).not.toThrow();
    else await expectGitError(check, 'GIT_DISALLOWED');
  });
});

describe('buildArgs', () => {
  it('fences revisions behind --end-of-options and paths behind --', () => {
    const argv = buildArgs('log', { args: ['--format=%H'], revs: ['main'], paths: ['src'] });
    expect(argv.slice(-6)).toEqual(['log', '--format=%H', '--end-of-options', 'main', '--', 'src']);
    expect(argv.slice(0, 2)).toEqual(['-c', 'core.quotepath=off']);
  });

  it('adds --end-of-options only when there are revisions, and -- only when asked', () => {
    expect(buildArgs('rev-parse', { args: ['--show-toplevel'] })).not.toContain('--end-of-options');
    expect(buildArgs('rev-parse', { args: ['--show-toplevel'] })).not.toContain('--');
    expect(buildArgs('log', { paths: [] }).at(-1)).toBe('--');
  });
});

describe('GitRunner with real git', () => {
  const git = new GitRunner();

  it('runs read commands in the repository', async () => {
    expect((await git.text('rev-parse', { cwd: linear.dir, args: ['HEAD'] })).trim()).toBe(linear.shas.head);
  });

  it('treats user revisions as revisions and dash-prefixed paths as paths', async () => {
    const sha = await git.text('log', {
      cwd: files.dir,
      args: ['--format=%H'],
      revs: ['HEAD'],
      paths: ['odd/-leading-dash.md'],
    });
    expect(sha.trim()).toBe(files.shas.root);
  });

  it('passes paths literally: no globs, no pathspec magic', async () => {
    const log = (path: string) => git.text('log', { cwd: files.dir, args: ['--format=%H'], paths: [path] });
    expect(await log('src/*.ts')).toBe('');
    expect(await log(':(glob)**/*.ts')).toBe('');
    expect((await log('src/api/login.ts')).trim().split('\n')).toHaveLength(2);
  });

  it('prints paths as UTF-8 regardless of the user config', async () => {
    const names = await git.text('ls-tree', { cwd: files.dir, args: ['-r', '--name-only', 'HEAD'] });
    expect(names.split('\n')).toEqual(expect.arrayContaining(['docs/naïve café.md', 'src/日本語/ファイル.ts']));
  });

  it('rejects unexpected exit codes with git’s message, and accepts expected ones', async () => {
    const error = await expectGitError(
      () => git.run('rev-parse', { cwd: linear.dir, args: ['--verify'], revs: ['no-such-branch'] }),
      'GIT_FAILED',
    );
    expect(error.exitCode).toBe(128);
    expect(error.message).toMatch(/fatal: Needed a single revision/);

    const result = await git.run('rev-parse', {
      cwd: linear.dir,
      args: ['-q', '--verify'],
      revs: ['no-such-branch'],
      okExitCodes: [0, 1],
    });
    expect(result.exitCode).toBe(1);
  });

  it('refuses commands that are not allowlisted without running anything', async () => {
    await expectGitError(() => git.run('commit' as ReadSubcommand, { cwd: linear.dir, args: ['-m', 'x'] }), 'GIT_DISALLOWED');
    await expectGitError(() => git.run('fetch' as ReadSubcommand, { cwd: linear.dir }), 'GIT_DISALLOWED');
  });

  it('reports a missing working directory', async () => {
    const error = await expectGitError(() => git.run('version', { cwd: '/no/such/dir' }), 'GIT_NOT_FOUND');
    expect(error.message).toMatch(/directory does not exist/);
  });
});

describe('GitRunner process handling', () => {
  let dir: string;
  let fake: (name: string, body: string) => string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gittree-fake-git-'));
    fake = (name, body) => {
      const path = join(dir, name);
      writeFileSync(path, `#!/bin/sh\n${body}\n`);
      chmodSync(path, 0o755);
      return path;
    };
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('strips GIT_* variables that would redirect git, and sets its own', async () => {
    const echo = fake('echo-env', "env | grep -E '^(GIT_|LC_ALL=|PAGER=)' | sort");
    const git = new GitRunner({
      gitPath: echo,
      env: {
        PATH: process.env.PATH,
        GIT_DIR: '/elsewhere/.git',
        GIT_WORK_TREE: '/elsewhere',
        GIT_INDEX_FILE: '/elsewhere/index',
        GIT_CONFIG_PARAMETERS: "'core.pager=evil'",
        GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work',
        GIT_CONFIG_GLOBAL: '/home/me/.gitconfig-work',
      },
    });
    const lines = (await git.text('version', { cwd: dir })).trim().split('\n');
    expect(lines).toEqual(
      expect.arrayContaining([
        'GIT_SSH_COMMAND=ssh -i ~/.ssh/work',
        'GIT_CONFIG_GLOBAL=/home/me/.gitconfig-work',
        'GIT_OPTIONAL_LOCKS=0',
        'GIT_TERMINAL_PROMPT=0',
        'GIT_LITERAL_PATHSPECS=1',
        'LC_ALL=C',
        'PAGER=cat',
      ]),
    );
    expect(lines.join('\n')).not.toMatch(/GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_CONFIG_PARAMETERS/);
  });

  it('kills a command that runs past its timeout', async () => {
    const git = new GitRunner({ gitPath: fake('sleepy', 'sleep 10') });
    const started = Date.now();
    await expectGitError(() => git.run('version', { cwd: dir, timeoutMs: 150 }), 'GIT_TIMEOUT');
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('kills a command when its signal aborts, and never starts one that is already aborted', async () => {
    const git = new GitRunner({ gitPath: fake('sleepy-abort', 'sleep 10') });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expectGitError(() => git.run('version', { cwd: dir, signal: controller.signal }), 'GIT_ABORTED');
    await expectGitError(() => git.run('version', { cwd: dir, signal: AbortSignal.abort() }), 'GIT_ABORTED');
  });

  it('stops reading output past the size limit', async () => {
    const git = new GitRunner({ gitPath: fake('chatty', 'head -c 200000 /dev/zero') });
    await expectGitError(() => git.run('version', { cwd: dir, maxOutputBytes: 1_000 }), 'GIT_OUTPUT_TOO_LARGE');
  });

  it('reports a missing git executable', async () => {
    const git = new GitRunner({ gitPath: join(dir, 'no-such-git') });
    const error = await expectGitError(() => git.run('version', { cwd: dir }), 'GIT_NOT_FOUND');
    expect(error.message).toMatch(/git executable not found/);
  });

  it('runs at most maxConcurrent processes at once', async () => {
    const git = new GitRunner({ gitPath: fake('short-nap', 'sleep 0.3'), maxConcurrent: 2 });
    const started = Date.now();
    await Promise.all(Array.from({ length: 4 }, () => git.run('version', { cwd: dir })));
    expect(Date.now() - started).toBeGreaterThanOrEqual(550);
  });

  it('lets a queued command be cancelled before it starts', async () => {
    const git = new GitRunner({ gitPath: fake('long-nap', 'sleep 1'), maxConcurrent: 1 });
    const running = git.run('version', { cwd: dir });
    const controller = new AbortController();
    const queued = git.run('version', { cwd: dir, signal: controller.signal });
    controller.abort();
    await expectGitError(() => queued, 'GIT_ABORTED');
    await running;
  });
});
