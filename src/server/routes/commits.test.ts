import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { DAY, fixtureGit, T0, type FixtureName } from '../../../test/fixtures/build.ts';
import { HOST, json, makeTestApp, signIn, type TestApp } from '../../../test/helpers/app.ts';
import type { ChangedFile, CommitDetails, FileDiff } from '../../shared/api.ts';
import { readCommitDetails, readCombined, readFileDiff } from '../commits/commit.ts';

const fixtures = inject('fixtures');
const { repos } = fixtures;
const NAMES: FixtureName[] = ['files', 'merges', 'people', 'conflicts', 'shallow', 'submodule', 'linear'];

let t: TestApp;
let cookie: string;

beforeAll(async () => {
  t = await makeTestApp(NAMES.map((name) => repos[name].dir));
  cookie = await signIn(t);
});
afterAll(() => t.app.close());

const repoOf = (name: FixtureName) => t.repos[NAMES.indexOf(name)]!;
const get = (url: string) => t.app.inject({ url, headers: { host: HOST, cookie } });
const sha = (name: FixtureName, label: string) => {
  const value = repos[name].shas[label];
  if (!value) throw new Error(`no ${label} in ${name}`);
  return value;
};

async function commit(name: FixtureName, label: string, query = ''): Promise<CommitDetails> {
  const response = await get(`/api/repos/${repoOf(name).id}/commits/${sha(name, label)}${query}`);
  expect(response.statusCode, response.body).toBe(200);
  return json<CommitDetails>(response);
}

async function diff(name: FixtureName, label: string, path: string, query = ''): Promise<FileDiff> {
  const response = await get(
    `/api/repos/${repoOf(name).id}/diff?sha=${sha(name, label)}&path=${encodeURIComponent(path)}${query}`,
  );
  expect(response.statusCode, response.body).toBe(200);
  return json<FileDiff>(response);
}

const file = (details: CommitDetails, path: string): ChangedFile | undefined => details.compare?.files.find((f) => f.path === path);

describe('GET /api/repos/:id/commits/:sha', () => {
  it('returns the full message, author and committer with their time zones', async () => {
    const details = await commit('people', 'cherry-picked');
    expect(details.author).toEqual({ name: 'Bob Jones', email: 'bob@example.com', time: T0 + 6 * DAY, tz: -300 });
    expect(details.committer).toEqual({ name: 'Alice Smith', email: 'alice@example.com', time: T0 + 8 * DAY, tz: 120 });
    expect((await commit('people', 'keys-in-body')).message).toBe('Store dates as ISO-8601 strings\n\nRefs SHOP-15 and OPS-7.');
    // .mailmap folds the old identity into Alice
    expect((await commit('people', 'old-identity')).author).toMatchObject({ name: 'Alice Smith', email: 'alice@example.com' });
  });

  it('lists renames with similarity, binary changes, mode changes, symlinks and deletions', async () => {
    const { shas } = repos.files;
    expect(await commit('files', 'rename')).toMatchObject({
      sha: shas.rename,
      parents: [shas.root],
      compare: {
        with: 1,
        files: [
          {
            path: 'src/api/login.ts',
            oldPath: 'src/auth.ts',
            status: 'renamed',
            similarity: expect.any(Number),
            additions: 1,
            deletions: 1,
            oldSize: expect.any(Number),
            newSize: expect.any(Number),
          },
        ],
      },
    });
    expect(file(await commit('files', 'binary'), 'assets/logo.png')).toMatchObject({ binary: true, additions: null, deletions: null });
    expect(file(await commit('files', 'mode-change'), 'scripts/build.sh')).toMatchObject({
      status: 'modified',
      oldMode: '100644',
      newMode: '100755',
      additions: 0,
      deletions: 0,
    });
    expect(file(await commit('files', 'symlink'), 'docs/readme-link.md')).toMatchObject({ status: 'added', newMode: '120000' });
    const deleted = file(await commit('files', 'delete'), 'legacy/format.js');
    expect(deleted).toMatchObject({ status: 'deleted', newMode: '000000', deletions: 8, oldSize: expect.any(Number) });
    expect(deleted).not.toHaveProperty('newSize');
  });

  it('compares a root commit with the empty tree, keeping unusual paths intact', async () => {
    const details = await commit('files', 'root');
    expect(details.parents).toEqual([]);
    expect(details.compare?.with).toBe('root');
    const paths = details.compare?.files.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining(['docs/naïve café.md', 'src/日本語/ファイル.ts', 'odd/tab\there.txt', 'odd/new\nline.txt', 'odd/"quoted".txt']),
    );
    expect(details.compare?.files.every((f) => f.status === 'added')).toBe(true);
  });

  it('compares a merge with the parent asked for', async () => {
    const { shas } = repos.merges;
    const first = await commit('merges', 'merge-login');
    expect(first.parents).toHaveLength(2);
    // What the merge brought into main: both login commits' files.
    expect(first.compare?.files.map((f) => f.path).sort()).toEqual(['notes/shop-12-add-login-form.md', 'notes/shop-12-login-api-client.md']);
    const second = await commit('merges', 'merge-login', '?parent=2');
    expect(second.compare).toEqual({ with: 2, files: [expect.objectContaining({ path: 'README.md', status: 'modified' })] });

    const octopus = await commit('merges', 'octopus', '?parent=4');
    expect(octopus.parents).toHaveLength(4);
    expect(octopus.compare?.with).toBe(4);
    expect(octopus.parents[0]).not.toBe(shas.octopus);
  });

  it('lists only the files a merge resolved itself for parent=cc', async () => {
    const details = await commit('conflicts', 'conflict-merge', '?parent=cc');
    // limits.ts merged cleanly (each side changed another line), so it isn't a resolution.
    expect(details.compare?.with).toBe('cc');
    expect(details.compare?.files).toEqual([
      expect.objectContaining({ path: 'NOTES.md', status: 'modified', additions: null, deletions: null }),
      expect.objectContaining({ path: 'src/retry.ts', status: 'modified', newSize: expect.any(Number) }),
    ]);
    // A clean merge has none.
    expect((await commit('merges', 'merge-login', '?parent=cc')).compare).toEqual({ with: 'cc', files: [] });
  });

  it('shows submodule updates without sizes', async () => {
    const entry = file(await commit('submodule', 'add-submodule'), 'vendor/linear');
    expect(entry).toMatchObject({ status: 'added', newMode: '160000' });
    expect(entry).not.toHaveProperty('newSize');
  });

  it("has no file list for a shallow clone's boundary commit", async () => {
    const boundary = fixtureGit(fixtures, repos.shallow.dir, ['rev-list', '--max-parents=0', 'HEAD']).split('\n')[0]!;
    const response = await get(`/api/repos/${repoOf('shallow').id}/commits/${boundary}`);
    expect(json(response)).toMatchObject({ sha: boundary, parents: [], boundary: true, compare: null });
  });

  it('refuses unknown commits, other objects, missing parents and bad input', async () => {
    const url = (name: FixtureName, object: string, query = '') => `/api/repos/${repoOf(name).id}/commits/${object}${query}`;
    const expectError = async (path: string, status: number, error: string) => {
      const response = await get(path);
      expect(response.statusCode, path).toBe(status);
      expect(json<{ error: string }>(response).error).toBe(error);
    };
    await expectError(url('merges', sha('files', 'root')), 404, 'commit_not_found');
    await expectError(url('linear', fixtureGit(fixtures, repos.linear.dir, ['rev-parse', 'HEAD^{tree}'])), 404, 'commit_not_found');
    await expectError(url('linear', sha('linear', 'tag:v1.0.0')), 404, 'commit_not_found'); // an annotated tag object
    await expectError(url('merges', sha('merges', 'merge-login'), '?parent=3'), 400, 'no_such_parent');
    await expectError(url('files', sha('files', 'root'), '?parent=2'), 400, 'no_such_parent');
    await expectError(url('linear', sha('linear', 'head'), '?parent=cc'), 400, 'not_a_merge');
    await expectError(url('linear', sha('linear', 'head'), '?parent=0'), 400, 'bad_request');
    await expectError(url('linear', 'HEAD'), 400, 'bad_request');
    await expectError(url('linear', sha('linear', 'head').slice(0, 12)), 400, 'bad_request');
  });
});

describe('GET /api/repos/:id/diff', () => {
  it('sends small files whole, as one hunk the viewer can fold', async () => {
    const result = await diff('files', 'rename', 'src/api/login.ts');
    expect(result).toMatchObject({ path: 'src/api/login.ts', oldPath: 'src/auth.ts', status: 'renamed', fullContext: true, columns: 1 });
    expect(result.hunks).toHaveLength(1);
    const [hunk] = result.hunks;
    expect(hunk?.old).toEqual([{ start: 1, count: 28 }]);
    expect(hunk?.new).toEqual({ start: 1, count: 28 });
    expect(hunk?.lines.filter((l) => l[0] !== ' ')).toEqual(['-export const AUTH_VERSION = 1;', '+export const AUTH_VERSION = 2;']);
  });

  it('sends the usual three lines of context above the size limit', async () => {
    const repo = repoOf('files');
    const details = await readCommitDetails(t.git, repo, sha('files', 'head'), 1);
    const request = {
      compare: 1 as const,
      path: 'src/api/login.ts',
      ignoreWhitespace: false,
      combined: () => readCombined(t.git, repo, details, false),
    };
    const whole = await readFileDiff(t.git, repo, details, request);
    const partial = await readFileDiff(t.git, repo, details, { ...request, fullContextMaxBytes: 100 });
    expect(whole.fullContext).toBe(true);
    expect(partial.fullContext).toBe(false);
    expect(partial.hunks.length).toBeGreaterThan(1);
    const changes = (d: FileDiff) => d.hunks.flatMap((h) => h.lines.filter((l) => l[0] !== ' '));
    expect(changes(partial)).toEqual(changes(whole));
  });

  it('covers additions, deletions, binary files, submodules and unusual paths', async () => {
    expect((await diff('files', 'root', 'odd/new\nline.txt')).hunks).toEqual([
      { old: [{ start: 0, count: 0 }], new: { start: 1, count: 1 }, heading: '', lines: ['+has a newline'] },
    ]);
    const deleted = await diff('files', 'delete', 'legacy/format.js');
    expect(deleted.hunks[0]?.lines.every((l) => l.startsWith('-'))).toBe(true);
    expect(await diff('files', 'binary', 'assets/logo.png')).toMatchObject({ binary: true, hunks: [] });
    expect((await diff('files', 'mode-change', 'scripts/build.sh')).hunks).toEqual([]);
    expect((await diff('submodule', 'add-submodule', 'vendor/linear')).hunks[0]?.lines).toEqual([
      `+Subproject commit ${repos.linear.shas.head}`,
    ]);
  });

  it('compares merges with the chosen parent', async () => {
    const result = await diff('merges', 'merge-login', 'README.md', '&parent=2');
    // Main's README fix, seen from the login branch.
    expect(result.hunks.flatMap((h) => h.lines.filter((l) => l[0] !== ' '))).toEqual(['+', '+A small web shop.']);
  });

  it('shows conflict resolutions with a marker column per parent', async () => {
    const result = await diff('conflicts', 'conflict-merge', 'src/retry.ts', '&parent=cc');
    expect(result).toMatchObject({ columns: 2, fullContext: false, status: 'modified' });
    expect(result.hunks[0]?.lines).toEqual(expect.arrayContaining(['-   attempts: 1,', ' -  attempts: 5,', '++  attempts: 4,']));
  });

  it('ignores whitespace on request', async () => {
    expect((await diff('conflicts', 'head', 'src/limits.ts')).hunks[0]?.lines.some((l) => l.startsWith('+'))).toBe(true);
    const ignored = await diff('conflicts', 'head', 'src/limits.ts', '&ws=1');
    expect(ignored.hunks.flatMap((h) => h.lines).every((l) => l.startsWith(' '))).toBe(true);
  });

  it('refuses paths the commit did not change', async () => {
    const response = await get(`/api/repos/${repoOf('files').id}/diff?sha=${sha('files', 'rename')}&path=README.md`);
    expect(response.statusCode).toBe(404);
    expect(json<{ error: string }>(response).error).toBe('file_not_changed');
  });
});
