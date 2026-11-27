/**
 * Builds the deterministic test repositories listed in PLAN.md §11. Fixed
 * identities, dates, time zones and contents, plus an isolated git config,
 * give identical commit SHAs on every machine and every run.
 *
 * Used by the Vitest and Playwright global setups; `pnpm fixtures [dir]`
 * builds them for manual exploration (default: test/fixtures/.repos).
 */
import { execFileSync } from 'node:child_process';
import { accessSync, chmodSync, constants, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Marks a folder as fixture output, so `pnpm fixtures` may replace it. */
export const FIXTURES_MARKER = '.gittree-fixtures';

export const HOUR = 3_600;
export const DAY = 24 * HOUR;
/** 2025-01-06 09:00:00 UTC, a Monday. Every fixture date is an offset from it. */
export const T0 = Date.UTC(2025, 0, 6, 9) / 1000;
/** The "current time" for age-based rules in tests, such as branch staleness: T0 + 210 days. */
export const FIXTURE_NOW = T0 + 210 * DAY;

/** Authors, each in their own time zone. `aliceOld` is folded into `alice` by the .mailmap in `people`. */
export const PEOPLE = {
  alice: { name: 'Alice Smith', email: 'alice@example.com', tz: '+0200' },
  aliceOld: { name: 'alice', email: 'alice@old-laptop.local', tz: '+0200' },
  bob: { name: 'Bob Jones', email: 'bob@example.com', tz: '-0500' },
  carol: { name: 'Carol Nguyen', email: 'carol@example.com', tz: '+0530' },
  zoe: { name: 'Zoë Ångström', email: 'zoe@example.com', tz: '+0100' },
} as const;
export type Person = keyof typeof PEOPLE;

export const FIXTURE_NAMES = [
  'linear', // straight history, annotated + lightweight tags
  'merges', // feature branches, criss-cross and octopus merges, Jira keys in branch names
  'multiRoot', // three root commits, one merged with --allow-unrelated-histories
  'files', // renames, moves, binary, mode change, symlink, unusual paths, a large file
  'people', // .mailmap duplicates, non-ASCII names, Jira keys and look-alikes, author ≠ committer
  'branches', // stale, merged, upstream-gone, remote-only, ahead/behind branches
  'branchesOrigin', // the bare remote of `branches`
  'detached', // detached HEAD
  'empty', // no commits
  'shallow', // --depth 3 clone of `merges`
  'worktree', // main checkout of a repo with a linked worktree
  'worktreeLinked', // the linked worktree
  'submodule', // superproject with `linear` as a submodule
  'conflicts', // a merge with a resolved conflict and an extra edit; a GitHub-style origin URL
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

export interface FixtureRepo {
  /** Real path of the work tree, or of the repository itself when bare. */
  dir: string;
  /** Objects tests refer to, by label (commits, and `tag:<name>` for tags). */
  shas: Record<string, string>;
}

export interface Fixtures {
  root: string;
  /** Use as "now" in tests of age-based rules. */
  now: number;
  repos: Record<FixtureName, FixtureRepo>;
}

const GLOBAL_CONFIG = `[user]
\tname = Fixture Builder
\temail = builder@example.com
[init]
\tdefaultBranch = main
[commit]
\tgpgsign = false
[tag]
\tgpgsign = false
[core]
\tautocrlf = false
[advice]
\tdetachedHead = false
[protocol "file"]
\tallow = always
[gc]
\tauto = 0
[maintenance]
\tauto = false
`;

/** gittree's own settings for E2E runs and previews (`XDG_CONFIG_HOME` = FIXTURE_CONFIG_HOME under the fixtures root). */
export const FIXTURE_CONFIG_HOME = join('.home', '.config');
export const FIXTURE_JIRA = { baseUrl: 'https://jira.example.com', projectKeys: ['SHOP', 'OPS'] };

/** Environment that runs git exactly as the builder did: no user or system config. */
export function fixtureGitEnv(root: string): NodeJS.ProcessEnv {
  const home = join(root, '.home');
  return {
    PATH: process.env.PATH ?? '',
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
    TZ: 'UTC',
  };
}

/** Runs git in a fixture repository with the builder's isolated environment. */
export function fixtureGit(fixtures: Pick<Fixtures, 'root'>, dir: string, args: readonly string[]): string {
  return execGit(dir, fixtureGitEnv(fixtures.root), args);
}

let gitBinary: string | undefined;

/** The real git binary: macOS's /usr/bin/git shim costs ~10 ms per call, which adds up over ~300 calls. */
function gitPath(): string {
  if (gitBinary === undefined) {
    try {
      const candidate = join(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), 'git');
      accessSync(candidate, constants.X_OK);
      gitBinary = candidate;
    } catch {
      gitBinary = 'git';
    }
  }
  return gitBinary;
}

function execGit(cwd: string, env: NodeJS.ProcessEnv, args: readonly string[]): string {
  return execFileSync(gitPath(), args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

export function buildFixtures(rootDir: string): Fixtures {
  mkdirSync(rootDir, { recursive: true });
  const root = realpathSync(rootDir);
  writeFileSync(join(root, FIXTURES_MARKER), 'Generated by test/fixtures/build.ts; safe to delete.\n');
  const env = fixtureGitEnv(root);
  mkdirSync(join(root, '.home'), { recursive: true });
  writeFileSync(join(root, '.home', '.gitconfig'), GLOBAL_CONFIG);
  mkdirSync(join(root, FIXTURE_CONFIG_HOME, 'gittree'), { recursive: true });
  writeFileSync(join(root, FIXTURE_CONFIG_HOME, 'gittree', 'config.json'), `${JSON.stringify({ jira: FIXTURE_JIRA }, null, 2)}\n`);
  const ctx: Context = { root, env };

  const linear = buildLinear(ctx);
  const merges = buildMerges(ctx);
  const branches = buildBranches(ctx);
  const worktree = buildWorktree(ctx);

  return {
    root,
    now: FIXTURE_NOW,
    repos: {
      linear: linear.result(),
      merges: merges.result(),
      multiRoot: buildMultiRoot(ctx).result(),
      files: buildFiles(ctx).result(),
      people: buildPeople(ctx).result(),
      branches: branches.repo.result(),
      branchesOrigin: branches.origin.result(),
      detached: buildDetached(ctx).result(),
      empty: init(ctx, 'empty').result(),
      shallow: buildShallow(ctx, merges).result(),
      worktree: worktree.main.result(),
      worktreeLinked: worktree.linked.result(),
      submodule: buildSubmodule(ctx).result(),
      conflicts: buildConflicts(ctx).result(),
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures

function buildLinear(ctx: Context): RepoBuilder {
  const r = init(ctx, 'linear');
  r.commit('Initial commit', { by: 'bob', at: T0, label: 'root', files: { 'README.md': '# Greeter\n' } });
  r.commit('Add greeting module', {
    by: 'alice',
    at: T0 + DAY,
    files: { 'src/greet.ts': "export const greet = (name: string) => `Hello, ${name}`;\n" },
  });
  r.commit('Add tests for greeting', {
    by: 'carol',
    at: T0 + 2 * DAY + 3 * HOUR,
    files: { 'test/greet.test.ts': "import { greet } from '../src/greet';\n\nconsole.assert(greet('Ada') === 'Hello, Ada');\n" },
  });
  r.tag('v1.0.0', { message: 'Release 1.0.0', by: 'bob', at: T0 + 2 * DAY + 5 * HOUR });
  r.commit('Support custom punctuation', {
    by: 'alice',
    at: T0 + 4 * DAY,
    files: { 'src/greet.ts': "export const greet = (name: string, end = '!') => `Hello, ${name}${end}`;\n" },
  });
  r.commit('Document usage\n\nExplains the punctuation option.', {
    by: 'zoe',
    at: T0 + 5 * DAY,
    files: { 'README.md': '# Greeter\n\nCall greet(name, end).\n' },
  });
  r.tag('v1.1.0'); // lightweight
  r.commit('Fix typo in README', {
    by: 'bob',
    at: T0 + 6 * DAY + 2 * HOUR,
    label: 'head',
    files: { 'README.md': '# Greeter\n\nCall greet(name, end?).\n' },
  });
  return r;
}

function buildMerges(ctx: Context): RepoBuilder {
  const r = init(ctx, 'merges');
  r.commit('Initial commit', { by: 'bob', at: T0, label: 'root', files: { 'README.md': '# Shop\n' } });
  r.commit('Add app shell', { by: 'alice', at: T0 + DAY });

  r.branch('feature/SHOP-12-login');
  r.commit('SHOP-12 Add login form', { by: 'alice', at: T0 + 2 * DAY });
  r.commit('SHOP-12 Login API client\n\nTalks to /api/session.', { by: 'alice', at: T0 + 3 * DAY });
  r.switch('main');
  r.commit('Fix typo in README', {
    by: 'bob',
    at: T0 + 3 * DAY + 2 * HOUR,
    files: { 'README.md': '# Shop\n\nA small web shop.\n' },
  });
  r.merge(['feature/SHOP-12-login'], "Merge branch 'feature/SHOP-12-login'", {
    by: 'alice',
    at: T0 + 4 * DAY,
    label: 'merge-login',
  });
  r.tag('v1.0.0', { message: 'Release 1.0.0', by: 'bob', at: T0 + 4 * DAY + HOUR });

  // Criss-cross: two branches merge each other before both land on main.
  r.branch('cross/a');
  r.commit('Cross A: add cache', { by: 'alice', at: T0 + 5 * DAY, label: 'cross-a1' });
  r.switch('main');
  r.branch('cross/b');
  r.commit('Cross B: add metrics', { by: 'bob', at: T0 + 5 * DAY + HOUR, label: 'cross-b1' });
  r.switch('cross/a');
  r.merge([r.sha('cross-b1')], 'Merge cross/b into cross/a', { by: 'alice', at: T0 + 6 * DAY, label: 'criss-a' });
  r.switch('cross/b');
  r.merge([r.sha('cross-a1')], 'Merge cross/a into cross/b', { by: 'bob', at: T0 + 6 * DAY + HOUR, label: 'criss-b' });
  r.switch('cross/a');
  r.commit('Cross A: tune cache size', { by: 'alice', at: T0 + 7 * DAY });
  r.switch('cross/b');
  r.commit('Cross B: export metrics', { by: 'bob', at: T0 + 7 * DAY + HOUR });
  r.switch('main');
  r.merge(['cross/a'], "Merge branch 'cross/a'", { by: 'alice', at: T0 + 8 * DAY });
  r.merge(['cross/b'], "Merge branch 'cross/b'", { by: 'bob', at: T0 + 8 * DAY + 2 * HOUR, label: 'merge-cross-b' });

  // Octopus: three topics in one merge.
  const topics = ['docs', 'ci', 'lint'];
  topics.forEach((topic, i) => {
    r.switch('main');
    r.branch(`topic/${topic}`);
    r.commit(`Topic: ${topic}`, { by: 'carol', at: T0 + 9 * DAY + i * HOUR });
  });
  r.switch('main');
  r.merge(
    topics.map((t) => `topic/${t}`),
    'Merge topics docs, ci and lint',
    { by: 'carol', at: T0 + 10 * DAY, label: 'octopus' },
  );

  // A feature that started long ago and lands later, and one still open.
  r.branch('feature/SHOP-15-cart', r.sha('merge-login'));
  r.commit('SHOP-15 Cart model', { by: 'carol', at: T0 + 10 * DAY + 2 * HOUR });
  r.commit('SHOP-15 Cart page', { by: 'carol', at: T0 + 11 * DAY });
  r.switch('main');
  r.merge(['feature/SHOP-15-cart'], "Merge branch 'feature/SHOP-15-cart'", {
    by: 'alice',
    at: T0 + 12 * DAY,
    label: 'merge-cart',
  });
  r.branch('feature/SHOP-20-search');
  r.commit('SHOP-20 Search box', { by: 'zoe', at: T0 + 13 * DAY });
  r.commit('SHOP-20 Search results', { by: 'zoe', at: T0 + 14 * DAY, label: 'search-tip' });
  r.switch('main');
  r.commit('Release 1.1.0', { by: 'bob', at: T0 + 15 * DAY, label: 'head' });
  r.tag('v1.1.0'); // lightweight
  return r;
}

function buildMultiRoot(ctx: Context): RepoBuilder {
  const r = init(ctx, 'multi-root');
  r.commit('Initial app', { by: 'alice', at: T0, label: 'root-app', files: { 'app/main.ts': 'console.log("app");\n' } });
  r.commit('Add config', { by: 'alice', at: T0 + DAY });
  r.orphan('docs');
  r.commit('Start documentation site', { by: 'zoe', at: T0 + 2 * DAY, label: 'root-docs', files: { 'docs/index.md': '# Docs\n' } });
  r.commit('Document install steps', { by: 'zoe', at: T0 + 3 * DAY });
  r.switch('main');
  r.merge(['docs'], 'Merge documentation history', {
    by: 'alice',
    at: T0 + 4 * DAY,
    label: 'merge-unrelated',
    allowUnrelated: true,
  });
  r.orphan('gh-pages'); // a third root that is never merged
  r.commit('Publish site', { by: 'zoe', at: T0 + 5 * DAY, label: 'root-pages', files: { 'index.html': '<h1>Docs</h1>\n' } });
  r.switch('main');
  return r;
}

function buildFiles(ctx: Context): RepoBuilder {
  const r = init(ctx, 'files');
  r.commit('Add auth module, helpers and assets', {
    by: 'bob',
    at: T0,
    label: 'root',
    files: {
      'README.md': '# Files\n',
      'src/auth.ts': authModule(1),
      'old/helpers.js': numberedLines('helper', 12),
      'old/format.js': numberedLines('format', 8),
      'assets/logo.png': fakePng(1),
      'docs/naïve café.md': '# Café notes\n',
      'src/日本語/ファイル.ts': 'export const 名前 = "ファイル";\n',
      'with space/file name.txt': 'spaces in the path\n',
      'odd/-leading-dash.md': 'starts with a dash\n',
      'odd/"quoted".txt': 'has quotes\n',
      'odd/tab\there.txt': 'has a tab\n',
      'odd/new\nline.txt': 'has a newline\n',
    },
  });
  r.commit('Rename auth to api/login', {
    by: 'alice',
    at: T0 + DAY,
    label: 'rename',
    files: { 'src/auth.ts': null, 'src/api/login.ts': authModule(2) },
  });
  r.commit('Move old helpers to legacy', {
    by: 'alice',
    at: T0 + 2 * DAY,
    label: 'move',
    files: {
      'old/helpers.js': null,
      'old/format.js': null,
      'legacy/helpers.js': numberedLines('helper', 12),
      'legacy/format.js': numberedLines('format', 8),
    },
  });
  r.commit('Update logo', { by: 'carol', at: T0 + 3 * DAY, label: 'binary', files: { 'assets/logo.png': fakePng(2) } });
  const buildScript = '#!/bin/sh\necho build\n';
  r.commit('Add build script', { by: 'bob', at: T0 + 4 * DAY, files: { 'scripts/build.sh': buildScript } });
  r.commit('Make build script executable', {
    by: 'bob',
    at: T0 + 4 * DAY + HOUR,
    label: 'mode-change',
    files: { 'scripts/build.sh': { executable: buildScript } },
  });
  r.commit('Link docs to README', {
    by: 'bob',
    at: T0 + 5 * DAY,
    label: 'symlink',
    files: { 'docs/readme-link.md': { symlink: '../README.md' } },
  });
  r.commit('Delete format helper', { by: 'alice', at: T0 + 6 * DAY, label: 'delete', files: { 'legacy/format.js': null } });
  r.commit('Add generated data', { by: 'zoe', at: T0 + 7 * DAY, label: 'large', files: { 'data/big.csv': csvRows(3000, 1) } });
  r.commit('Edit login and data', {
    by: 'alice',
    at: T0 + 8 * DAY,
    label: 'head',
    files: { 'src/api/login.ts': authModule(3), 'data/big.csv': csvRows(3000, 7) },
  });
  return r;
}

function buildPeople(ctx: Context): RepoBuilder {
  const r = init(ctx, 'people');
  r.commit('Initial commit', {
    by: 'alice',
    at: T0,
    label: 'root',
    files: {
      'README.md': '# People\n',
      '.mailmap': 'Alice Smith <alice@example.com> alice <alice@old-laptop.local>\n',
    },
  });
  r.commit('SHOP-12 Add login form', { by: 'aliceOld', at: T0 + DAY + 2 * HOUR, label: 'old-identity' });
  r.commit('OPS-3 Configure CI pipeline', { by: 'bob', at: T0 + 2 * DAY + 14 * HOUR });
  r.commit('Switch file encoding to UTF-8', { by: 'carol', at: T0 + 3 * DAY + 5 * HOUR, label: 'looks-like-key-utf8' });
  r.commit('Use SHA-256 for checksums', { by: 'zoe', at: T0 + 4 * DAY + 20 * HOUR, label: 'looks-like-key-sha' });
  r.commit('Store dates as ISO-8601 strings\n\nRefs SHOP-15 and OPS-7.', {
    by: 'alice',
    at: T0 + 5 * DAY + 9 * HOUR,
    label: 'keys-in-body',
  });
  r.commit('Fix SHOP-12 login redirect', {
    by: 'bob',
    at: T0 + 6 * DAY,
    committer: { by: 'alice', at: T0 + 8 * DAY }, // cherry-picked by someone else, later
    label: 'cherry-picked',
  });
  r.branch('feature/SHOP-123-login');
  r.commit('Wire login screen', { by: 'aliceOld', at: T0 + 9 * DAY, label: 'branch-with-key' });
  r.switch('main');
  return r;
}

/**
 * Relative to FIXTURE_NOW: feature/payments is active (3 days), origin/hotfix/typo
 * aging (34 days, remote only), bugfix/null-check aging with its upstream gone,
 * feature/SHOP-7-export stale (205 days), feature/SHOP-3-search merged,
 * release/1.x one behind its upstream, main one ahead of origin/main.
 */
function buildBranches(ctx: Context): { repo: RepoBuilder; origin: RepoBuilder } {
  const origin = init(ctx, 'branches-origin.git', { bare: true });
  const r = init(ctx, 'branches');
  r.git(['remote', 'add', 'origin', origin.dir]);
  r.commit('Initial commit', { by: 'bob', at: T0, label: 'root', files: { 'README.md': '# Branches\n' } });
  r.commit('Add payments skeleton', { by: 'alice', at: T0 + DAY });

  r.branch('feature/SHOP-7-export');
  r.commit('SHOP-7 Export orders as CSV', { by: 'carol', at: T0 + 3 * DAY });
  r.commit('SHOP-7 Add export button', { by: 'carol', at: T0 + 5 * DAY, label: 'stale-tip' });
  r.switch('main');
  r.commit('Add order list', { by: 'bob', at: T0 + 20 * DAY });

  r.branch('feature/SHOP-3-search');
  r.commit('SHOP-3 Search index', { by: 'alice', at: T0 + 40 * DAY });
  r.commit('SHOP-3 Search page', { by: 'alice', at: T0 + 45 * DAY, label: 'merged-tip' });
  r.switch('main');
  r.merge(['feature/SHOP-3-search'], "Merge branch 'feature/SHOP-3-search'", { by: 'bob', at: T0 + 60 * DAY });
  r.commit('Tidy order list', { by: 'bob', at: T0 + 100 * DAY });

  r.branch('release/1.x');
  r.commit('Prepare 1.x release', { by: 'bob', at: T0 + 101 * DAY, label: 'behind-tip' });
  r.commit('Bump 1.x patch version', { by: 'bob', at: T0 + 102 * DAY, label: 'behind-upstream' });
  r.git(['push', '-q', '-u', 'origin', 'release/1.x']);
  r.switch('main');
  r.git(['branch', '-f', 'release/1.x', 'release/1.x~1']); // keeps its upstream, now one behind

  r.branch('bugfix/null-check');
  r.commit('Guard against null customer', { by: 'bob', at: T0 + 150 * DAY, label: 'gone-tip' });
  r.git(['push', '-q', '-u', 'origin', 'bugfix/null-check']);
  r.switch('main');
  r.commit('Update dependencies', { by: 'alice', at: T0 + 170 * DAY });

  r.branch('hotfix/typo');
  r.commit('Fix typo in checkout', { by: 'bob', at: T0 + 176 * DAY, label: 'remote-only-tip' });
  r.git(['push', '-q', 'origin', 'hotfix/typo']);
  r.switch('main');
  r.git(['branch', '-q', '-D', 'hotfix/typo']);

  r.branch('feature/payments');
  r.commit('Payments: card form', { by: 'alice', at: T0 + 195 * DAY });
  r.commit('Payments: validation', { by: 'alice', at: T0 + 205 * DAY });
  r.git(['push', '-q', '-u', 'origin', 'feature/payments']);
  r.commit('Payments: error states', { by: 'alice', at: T0 + 207 * DAY, label: 'active-tip' });
  r.switch('main');
  r.commit('Release 1.2.0', { by: 'bob', at: T0 + 200 * DAY, label: 'origin-main' });
  r.git(['push', '-q', '-u', 'origin', 'main']);
  r.git(['remote', 'set-head', 'origin', 'main']);
  r.commit('Start 1.3 development', { by: 'alice', at: T0 + 208 * DAY, label: 'head' });

  // Someone deletes bugfix/null-check on the remote; a pruning fetch notices.
  origin.git(['branch', '-q', '-D', 'bugfix/null-check']);
  r.git(['fetch', '-q', '--prune', 'origin']);
  return { repo: r, origin };
}

function buildDetached(ctx: Context): RepoBuilder {
  const r = init(ctx, 'detached');
  r.commit('Initial commit', { by: 'bob', at: T0, files: { 'README.md': '# Detached\n' } });
  r.commit('Second commit', { by: 'alice', at: T0 + DAY, label: 'detached-at' });
  r.commit('Third commit', { by: 'alice', at: T0 + 2 * DAY, label: 'main-tip' });
  r.git(['checkout', '-q', '--detach', 'HEAD~1']);
  return r;
}

function buildShallow(ctx: Context, source: RepoBuilder): RepoBuilder {
  const dir = join(ctx.root, 'shallow');
  // file:// so that --depth applies (plain local clones ignore it).
  run(ctx, ctx.root, ['clone', '-q', '--depth', '3', '--no-single-branch', `file://${source.dir}`, dir]);
  return new RepoBuilder(dir, ctx.env);
}

function buildWorktree(ctx: Context): { main: RepoBuilder; linked: RepoBuilder } {
  const main = init(ctx, 'worktree');
  main.commit('Initial commit', { by: 'alice', at: T0, files: { 'README.md': '# Worktree\n' } });
  main.commit('Main work', { by: 'alice', at: T0 + DAY, label: 'main-tip' });
  const linkedDir = join(ctx.root, 'worktree-linked');
  main.git(['worktree', 'add', '-q', '-b', 'wt/feature', linkedDir]);
  const linked = new RepoBuilder(linkedDir, ctx.env);
  linked.commit('Work in the linked worktree', { by: 'bob', at: T0 + 2 * DAY, label: 'linked-tip' });
  return { main, linked };
}

function buildSubmodule(ctx: Context): RepoBuilder {
  const r = init(ctx, 'submodule');
  r.commit('Initial commit', { by: 'alice', at: T0, files: { 'README.md': '# Superproject\n' } });
  // A relative URL resolves against the superproject's folder and keeps .gitmodules (and the SHAs) stable.
  r.git(['submodule', '--quiet', 'add', '../linear', 'vendor/linear']);
  r.commit('Add linear as a submodule', { by: 'alice', at: T0 + DAY, label: 'add-submodule', files: {} });
  return r;
}

/**
 * Both sides change `attempts` in retry.ts (a conflict, resolved to a value
 * neither side had); main also changes `delayMs`, which merges cleanly. Each
 * side changes a different line of limits.ts (a clean 3-way merge), and the
 * merge edits NOTES.md, which neither side touched (an "evil merge"). The last
 * commit only changes indentation.
 */
function buildConflicts(ctx: Context): RepoBuilder {
  const r = init(ctx, 'conflicts');
  // Only ever read for the "view on GitHub" link; nothing is fetched from it.
  r.git(['remote', 'add', 'origin', 'https://github.com/example/shop.git']);
  r.commit('Add retry settings', {
    by: 'alice',
    at: T0,
    label: 'root',
    files: { 'src/retry.ts': retryModule(3, 100), 'src/limits.ts': limitsModule(10, 20), 'NOTES.md': '# Notes\n' },
  });
  r.branch('feature/SHOP-31-retries');
  r.commit('SHOP-31 Retry five times', {
    by: 'bob',
    at: T0 + DAY,
    label: 'feature-tip',
    files: { 'src/retry.ts': retryModule(5, 100), 'src/limits.ts': limitsModule(10, 40) },
  });
  r.switch('main');
  r.commit('Retry once, back off longer', {
    by: 'carol',
    at: T0 + DAY + 2 * HOUR,
    label: 'main-side',
    files: { 'src/retry.ts': retryModule(1, 500), 'src/limits.ts': limitsModule(15, 20) },
  });
  r.mergeResolving(['feature/SHOP-31-retries'], "Merge branch 'feature/SHOP-31-retries'", {
    by: 'alice',
    at: T0 + 2 * DAY,
    label: 'conflict-merge',
    files: { 'src/retry.ts': retryModule(4, 500), 'NOTES.md': '# Notes\n\nRetries settled at 4.\n' },
  });
  // Whitespace only: the merged limits (main's rate, the feature's burst), indented by four.
  r.commit('Indent limits by four spaces', {
    by: 'zoe',
    at: T0 + 3 * DAY,
    label: 'head',
    files: { 'src/limits.ts': limitsModule(15, 40).replace(/^ {2}/gm, '    ') },
  });
  return r;
}

// ---------------------------------------------------------------------------
// Builder

interface Context {
  root: string;
  env: NodeJS.ProcessEnv;
}

type FileContent = string | Uint8Array | { executable: string } | { symlink: string } | null;

interface CommitOptions {
  by: Person;
  at: number;
  /** Files to write (null deletes). Default: a new note file named after the message. */
  files?: Record<string, FileContent>;
  /** Defaults to the author at the same time. */
  committer?: { by: Person; at: number };
  label?: string;
}

class RepoBuilder {
  readonly dir: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #shas: Record<string, string> = {};
  #notes = 0;

  constructor(dir: string, env: NodeJS.ProcessEnv) {
    this.dir = dir;
    this.#env = env;
  }

  git(args: readonly string[], extraEnv: NodeJS.ProcessEnv = {}): string {
    return execGit(this.dir, { ...this.#env, ...extraEnv }, args);
  }

  sha(label: string): string {
    const sha = this.#shas[label];
    if (!sha) throw new Error(`no commit labelled ${label} in ${this.dir}`);
    return sha;
  }

  result(): FixtureRepo {
    return { dir: this.dir, shas: { ...this.#shas } };
  }

  commit(message: string, options: CommitOptions): void {
    this.#write(options.files ?? { [`notes/${slug(message)}.md`]: `${message} (${++this.#notes})\n` });
    this.git(['add', '-A']);
    const committer = options.committer ?? options;
    this.git(['commit', '-q', '-m', message], {
      ...identity('AUTHOR', options.by, options.at),
      ...identity('COMMITTER', committer.by, committer.at),
    });
    this.#label(options.label);
  }

  merge(
    revs: readonly string[],
    message: string,
    options: { by: Person; at: number; label?: string; allowUnrelated?: boolean },
  ): void {
    const args = ['merge', '-q', '--no-ff', '--no-edit', '-m', message];
    if (options.allowUnrelated) args.push('--allow-unrelated-histories');
    this.git([...args, ...revs], { ...identity('AUTHOR', options.by, options.at), ...identity('COMMITTER', options.by, options.at) });
    this.#label(options.label);
  }

  /** Merges with --no-commit, lets conflicts happen, writes the resolution and commits the merge. */
  mergeResolving(
    revs: readonly string[],
    message: string,
    options: { by: Person; at: number; label?: string; files: Record<string, FileContent> },
  ): void {
    const env = { ...identity('AUTHOR', options.by, options.at), ...identity('COMMITTER', options.by, options.at) };
    try {
      this.git(['merge', '-q', '--no-ff', '--no-commit', ...revs], env);
    } catch {
      // exit 1: conflicts, which the files below resolve
    }
    this.#write(options.files);
    this.git(['add', '-A']);
    this.git(['commit', '-q', '--no-edit', '-m', message], env);
    this.#label(options.label);
  }

  /** Creates a branch at `start` (default: HEAD) and checks it out. */
  branch(name: string, start?: string): void {
    this.git(['checkout', '-q', '-b', name, ...(start ? [start] : [])]);
  }

  switch(name: string): void {
    this.git(['checkout', '-q', name]);
  }

  /** Starts a new, empty history on `name`. */
  orphan(name: string): void {
    this.git(['checkout', '-q', '--orphan', name]);
    this.git(['rm', '-q', '-r', '-f', '--ignore-unmatch', '.']);
  }

  /** Annotated when a message is given, lightweight otherwise. Records `tag:<name>`. */
  tag(name: string, options: { message?: string; by?: Person; at?: number } = {}): void {
    if (options.message === undefined) {
      this.git(['tag', name]);
    } else {
      this.git(['tag', '-a', name, '-m', options.message], identity('COMMITTER', options.by ?? 'bob', options.at ?? T0));
    }
    this.#shas[`tag:${name}`] = this.git(['rev-parse', name]);
  }

  /** Records HEAD under `label`, if given. */
  #label(label: string | undefined): void {
    if (!label) return;
    if (this.#shas[label]) throw new Error(`duplicate label ${label} in ${this.dir}`);
    this.#shas[label] = this.git(['rev-parse', 'HEAD']);
  }

  #write(files: Record<string, FileContent>): void {
    for (const [path, content] of Object.entries(files)) {
      if (content === null) {
        this.git(['rm', '-q', '-r', '--', path]);
        continue;
      }
      const full = join(this.dir, path);
      mkdirSync(dirname(full), { recursive: true });
      rmSync(full, { force: true }); // replaces files and symlinks alike
      if (typeof content === 'string' || content instanceof Uint8Array) {
        writeFileSync(full, content);
      } else if ('symlink' in content) {
        symlinkSync(content.symlink, full);
      } else {
        writeFileSync(full, content.executable);
        chmodSync(full, 0o755);
      }
    }
  }
}

function init(ctx: Context, name: string, options: { bare?: boolean } = {}): RepoBuilder {
  const dir = join(ctx.root, name);
  run(ctx, ctx.root, ['init', '-q', '-b', 'main', ...(options.bare ? ['--bare'] : []), dir]);
  return new RepoBuilder(dir, ctx.env);
}

function run(ctx: Context, cwd: string, args: readonly string[]): string {
  return execGit(cwd, ctx.env, args);
}

function identity(role: 'AUTHOR' | 'COMMITTER', who: Person, at: number): NodeJS.ProcessEnv {
  const person = PEOPLE[who];
  return {
    [`GIT_${role}_NAME`]: person.name,
    [`GIT_${role}_EMAIL`]: person.email,
    [`GIT_${role}_DATE`]: `@${at} ${person.tz}`,
  };
}

function slug(message: string): string {
  const subject = message.split('\n', 1)[0] ?? message;
  return subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'note';
}

// ---------------------------------------------------------------------------
// Content generators (deterministic)

function numberedLines(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, i) => `export const ${prefix}${i + 1} = ${i + 1};\n`).join('');
}

/** ~30 lines; each version changes a couple, so renames between versions stay detectable. */
function authModule(version: number): string {
  const lines = [
    "import { post } from './http';",
    '',
    'export interface Credentials {',
    '  user: string;',
    '  pass: string;',
    '}',
    '',
    `export const AUTH_VERSION = ${version};`,
    '',
    'export async function login({ user, pass }: Credentials) {',
    "  const response = await post('/api/session', { user, pass });",
    '  if (!response.ok) {',
    "    throw new Error('login failed');",
    '  }',
    '  return response.json();',
    '}',
    '',
    'export async function logout() {',
    "  await post('/api/session/end', {});",
    '}',
    '',
    'export function isExpired(expiresAt: number, now = Date.now()) {',
    '  return expiresAt <= now;',
    '}',
    '',
    'export function bearer(token: string) {',
    '  return `Bearer ${token}`;',
    '}',
  ];
  if (version >= 3) lines.push('', 'export const REFRESH_WINDOW_MS = 60_000;');
  return `${lines.join('\n')}\n`;
}

function retryModule(attempts: number, delayMs: number): string {
  return [
    'export const RETRY = {',
    `  attempts: ${attempts},`,
    '  // Delay before the first retry; doubles after each attempt.',
    '  // Kept short so tests stay fast.',
    '  // Raise it for slow networks.',
    `  delayMs: ${delayMs},`,
    '};',
    '',
  ].join('\n');
}

function limitsModule(perSecond: number, burst: number): string {
  return [
    'export const LIMITS = {',
    `  perSecond: ${perSecond},`,
    '  // Requests above the rate are queued,',
    '  // up to the burst size; the rest fail.',
    '  queue: true,',
    '  log: false,',
    `  burst: ${burst},`,
    '};',
    '',
  ].join('\n');
}

function csvRows(count: number, seed: number): string {
  const rows = ['id,sku,quantity,price'];
  for (let i = 1; i <= count; i++) rows.push(`${i},SKU-${(i * 7919 + seed) % 10_000},${(i * seed) % 17},${((i * 31 + seed) % 9_999) / 100}`);
  return `${rows.join('\n')}\n`;
}

/** PNG signature and header chunk, then seeded noise: binary to git (it contains NUL bytes). */
function fakePng(seed: number): Uint8Array {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52];
  const bytes = new Uint8Array(header.length + 2048);
  bytes.set(header);
  let state = seed >>> 0;
  for (let i = header.length; i < bytes.length; i++) {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    bytes[i] = (t ^ (t >>> 14)) & 0xff;
  }
  return bytes;
}
