import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, inject, it } from 'vitest';

import { buildFixtures, DAY, FIXTURE_NAMES, FIXTURE_NOW, fixtureGit, T0, type FixtureName } from './build.ts';

const fixtures = inject('fixtures');
const { repos } = fixtures;
const git = (name: FixtureName, ...args: string[]) => fixtureGit(fixtures, repos[name].dir, args);
const lines = (text: string) => (text === '' ? [] : text.split('\n'));
/** Runs git and returns its exit code instead of throwing. */
const exitCode = (name: FixtureName, ...args: string[]) => {
  try {
    git(name, ...args);
    return 0;
  } catch (error) {
    return (error as { status: number }).status;
  }
};

describe('fixture builder', () => {
  it('builds identical repositories every time', () => {
    const other = mkdtempSync(join(realpathSync(tmpdir()), 'gittree-fixtures-again-'));
    try {
      const again = buildFixtures(other);
      for (const name of FIXTURE_NAMES) {
        const refs = (root: string, dir: string) =>
          fixtureGit({ root }, dir, ['for-each-ref', '--format=%(objectname) %(refname)']);
        expect(refs(other, again.repos[name].dir), name).toBe(refs(fixtures.root, repos[name].dir));
        expect(again.repos[name].shas, name).toEqual(repos[name].shas);
      }
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  }, 60_000);

  it('dates everything relative to a fixed origin', () => {
    expect(fixtures.now).toBe(FIXTURE_NOW);
    expect(new Date(T0 * 1000).toISOString()).toBe('2025-01-06T09:00:00.000Z');
  });
});

describe('fixture scenarios', () => {
  it('linear: straight history with an annotated and a lightweight tag', () => {
    expect(git('linear', 'rev-list', '--count', 'HEAD')).toBe('6');
    expect(git('linear', 'rev-list', '--min-parents=2', '--count', 'HEAD')).toBe('0');
    expect(git('linear', 'cat-file', '-t', 'v1.0.0')).toBe('tag');
    expect(git('linear', 'cat-file', '-t', 'v1.1.0')).toBe('commit');
  });

  it('merges: feature merges, a criss-cross and an octopus merge', () => {
    const { shas } = repos.merges;
    expect(lines(git('merges', 'rev-list', '--min-parents=3', 'HEAD'))).toEqual([shas.octopus]);
    // the merge itself, then main and the three topics
    expect(git('merges', 'rev-list', '--parents', '-n1', shas.octopus!).split(' ')).toHaveLength(5);
    // Two best common ancestors: the criss-cross.
    const bases = git('merges', 'merge-base', '--all', `${shas['merge-cross-b']}^1`, `${shas['merge-cross-b']}^2`);
    expect(lines(bases).sort()).toEqual([shas['cross-a1'], shas['cross-b1']].sort());
    expect(git('merges', 'branch', '--format=%(refname:short)', '--no-merged', 'main')).toBe('feature/SHOP-20-search');
  });

  it('multiRoot: three root commits, two of them merged', () => {
    const { shas } = repos.multiRoot;
    const roots = lines(git('multiRoot', 'rev-list', '--max-parents=0', '--all')).sort();
    expect(roots).toEqual([shas['root-app'], shas['root-docs'], shas['root-pages']].sort());
    expect(lines(git('multiRoot', 'rev-list', '--max-parents=0', 'main')).sort()).toEqual(
      [shas['root-app'], shas['root-docs']].sort(),
    );
  });

  it('files: rename, move, binary change, mode change, symlink and a large file', () => {
    const { shas } = repos.files;
    const nameStatus = (sha: string) => git('files', 'diff-tree', '-r', '-M', '--no-commit-id', '--name-status', sha);
    expect(nameStatus(shas.rename!)).toMatch(/^R\d{2,3}\tsrc\/auth\.ts\tsrc\/api\/login\.ts$/m);
    expect(nameStatus(shas.move!)).toMatch(/^R100\told\/helpers\.js\tlegacy\/helpers\.js$/m);
    expect(git('files', 'diff-tree', '-r', '--no-commit-id', '--numstat', shas.binary!)).toBe('-\t-\tassets/logo.png');
    expect(git('files', 'diff-tree', '-r', '--no-commit-id', '--summary', shas['mode-change']!)).toBe(
      ' mode change 100644 => 100755 scripts/build.sh',
    );
    expect(git('files', 'ls-tree', 'HEAD', 'docs/readme-link.md')).toMatch(/^120000 blob /);
    expect(Number(git('files', 'show', 'HEAD:data/big.csv').split('\n').length)).toBe(3001);
    expect(lines(git('files', 'log', '--follow', '--format=%H', '--', 'src/api/login.ts'))).toContain(shas.root);
  });

  it('files: unusual path names survive as-is', () => {
    const names = git('files', 'ls-tree', '-r', '-z', '--name-only', 'HEAD').split('\0');
    expect(names).toEqual(
      expect.arrayContaining([
        'docs/naïve café.md',
        'src/日本語/ファイル.ts',
        'with space/file name.txt',
        'odd/-leading-dash.md',
        'odd/"quoted".txt',
        'odd/tab\there.txt',
        'odd/new\nline.txt',
      ]),
    );
  });

  it('people: .mailmap folds two identities, keys and look-alikes in messages', () => {
    const mapped = new Set(lines(git('people', 'log', '--all', '--format=%aN <%aE>')));
    expect([...mapped].sort()).toEqual(
      ['Alice Smith <alice@example.com>', 'Bob Jones <bob@example.com>', 'Carol Nguyen <carol@example.com>', 'Zoë Ångström <zoe@example.com>'].sort(),
    );
    expect(lines(git('people', 'log', '--all', '--format=%an <%ae>'))).toContain('alice <alice@old-laptop.local>');
    const subjects = lines(git('people', 'log', '--format=%s'));
    expect(subjects).toEqual(expect.arrayContaining(['Switch file encoding to UTF-8', 'Use SHA-256 for checksums']));
    expect(git('people', 'show', '-s', '--format=%an|%cn|%ai|%ci', repos.people.shas['cherry-picked']!)).toBe(
      'Bob Jones|Alice Smith|2025-01-12 04:00:00 -0500|2025-01-14 11:00:00 +0200',
    );
  });

  it('branches: active, aging, stale, merged, gone, remote-only, ahead and behind', () => {
    const tracking = Object.fromEntries(
      lines(git('branches', 'for-each-ref', '--format=%(refname:short)|%(upstream:track)', 'refs/heads')).map((line) =>
        line.split('|'),
      ),
    );
    expect(tracking).toEqual({
      'bugfix/null-check': '[gone]',
      'feature/SHOP-3-search': '',
      'feature/SHOP-7-export': '',
      'feature/payments': '[ahead 1]',
      main: '[ahead 1]',
      'release/1.x': '[behind 1]',
    });
    expect(lines(git('branches', 'for-each-ref', '--format=%(refname:short)', 'refs/remotes')).sort()).toEqual(
      ['origin', 'origin/feature/payments', 'origin/hotfix/typo', 'origin/main', 'origin/release/1.x'].sort(),
    );
    const { shas } = repos.branches;
    expect(exitCode('branches', 'merge-base', '--is-ancestor', shas['merged-tip']!, 'main')).toBe(0);
    expect(exitCode('branches', 'merge-base', '--is-ancestor', shas['stale-tip']!, 'main')).toBe(1);
    const ageInDays = (rev: string) => (FIXTURE_NOW - Number(git('branches', 'show', '-s', '--format=%ct', rev))) / DAY;
    expect(ageInDays('feature/payments')).toBe(3);
    expect(ageInDays('origin/hotfix/typo')).toBe(34);
    expect(ageInDays('feature/SHOP-7-export')).toBe(205);
  });

  it('detached, empty and shallow repositories', () => {
    expect(exitCode('detached', 'symbolic-ref', '-q', 'HEAD')).toBe(1);
    expect(git('detached', 'rev-parse', 'HEAD')).toBe(repos.detached.shas['detached-at']);

    expect(git('empty', 'rev-list', '--all', '--count')).toBe('0');
    expect(exitCode('empty', 'rev-parse', '-q', '--verify', 'HEAD')).toBe(1);

    expect(git('shallow', 'rev-parse', '--is-shallow-repository')).toBe('true');
    expect(git('shallow', 'rev-parse', 'HEAD')).toBe(repos.merges.shas.head);
    expect(git('shallow', 'rev-parse', '--verify', 'origin/feature/SHOP-20-search')).toBe(repos.merges.shas['search-tip']);
  });

  it('worktree: a linked worktree with its own branch', () => {
    const linkedDotGit = join(repos.worktreeLinked.dir, '.git');
    expect(lstatSync(linkedDotGit).isFile()).toBe(true);
    expect(git('worktreeLinked', 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('wt/feature');
    expect(realpathSync(git('worktreeLinked', 'rev-parse', '--path-format=absolute', '--git-common-dir'))).toBe(
      join(repos.worktree.dir, '.git'),
    );
    expect(git('worktree', 'rev-parse', 'wt/feature')).toBe(repos.worktreeLinked.shas['linked-tip']);
  });

  it('submodule: a gitlink to linear with a relative URL', () => {
    expect(git('submodule', 'ls-tree', 'HEAD', 'vendor/linear')).toBe(`160000 commit ${repos.linear.shas.head}\tvendor/linear`);
    expect(git('submodule', 'config', '--file', '.gitmodules', '--get', 'submodule.vendor/linear.url')).toBe('../linear');
    expect(existsSync(join(repos.submodule.dir, 'vendor', 'linear', 'README.md'))).toBe(true);
  });

  it('conflicts: a resolved conflict, an edit only the merge made, a clean 3-way merge, a whitespace-only commit', () => {
    const { shas } = repos.conflicts;
    const merge = shas['conflict-merge']!;
    expect(git('conflicts', 'rev-list', '--parents', '-n1', merge).split(' ')).toEqual([merge, shas['main-side'], shas['feature-tip']]);
    // Every file differs from both parents, but only two hunks are the merge's own work.
    expect(lines(git('conflicts', 'diff-tree', '-r', '--cc', '--name-only', '--no-commit-id', '-c', merge))).toEqual([
      'NOTES.md',
      'src/limits.ts',
      'src/retry.ts',
    ]);
    expect(git('conflicts', 'diff-tree', '-r', '--cc', '-p', '--no-commit-id', merge)).not.toContain('limits.ts');
    expect(git('conflicts', 'show', 'HEAD:src/retry.ts')).toContain('attempts: 4,');
    expect(git('conflicts', 'diff', '-w', '--stat', 'HEAD~1', 'HEAD')).toBe('');
    expect(git('conflicts', 'config', '--get', 'remote.origin.url')).toBe('https://github.com/example/shop.git');
  });
});
