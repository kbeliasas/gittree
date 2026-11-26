import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { DAY, fixtureGit, T0, type FixtureName } from '../../../test/fixtures/build.ts';
import { HOST, json, makeTestApp, signIn, type TestApp } from '../../../test/helpers/app.ts';
import type { GraphCommit, GraphPayload } from '../../shared/api.ts';

const fixtures = inject('fixtures');
const { repos } = fixtures;

const WITH_COMMITS: FixtureName[] = [
  'linear',
  'merges',
  'multiRoot',
  'files',
  'people',
  'branches',
  'branchesOrigin',
  'detached',
  'shallow',
  'worktree',
  'worktreeLinked',
  'submodule',
];

// A private copy this file may change; the shared fixtures must stay byte-identical.
const scratch = mkdtempSync(join(realpathSync(tmpdir()), 'gittree-graph-'));
const copy = join(scratch, 'linear-copy');
cpSync(repos.linear.dir, copy, { recursive: true });

let t: TestApp;
let cookie: string;

beforeAll(async () => {
  t = await makeTestApp([...WITH_COMMITS.map((name) => repos[name].dir), repos.empty.dir, copy]);
  cookie = await signIn(t);
});
afterAll(async () => {
  await t.app.close();
  rmSync(scratch, { recursive: true, force: true });
});

const idOf = (dir: string) => {
  const repo = t.repos.find((r) => r.path === dir);
  if (!repo) throw new Error(`no test repo at ${dir}`);
  return repo.id;
};
const request = (dir: string, query = '') =>
  t.app.inject({ url: `/api/repos/${idOf(dir)}/graph${query}`, headers: { host: HOST, cookie } });
const graph = async (dir: string, query = '') => {
  const response = await request(dir, query);
  expect(response.statusCode, response.body).toBe(200);
  return json<GraphPayload>(response);
};
/** Parent hashes of a commit, whichever way the page encodes them. */
const parentShas = (commit: GraphCommit, shaAt: (index: number) => string | undefined) =>
  commit.parents.map((p) => (typeof p === 'number' ? shaAt(p) : p));
const refCommit = (payload: GraphPayload, name: string) => {
  const ref = payload.refs.find((r) => r.name === name);
  return ref && payload.commits[ref.commit - payload.page.offset]?.sha;
};

describe('GET /api/repos/:id/graph', () => {
  it.each(WITH_COMMITS)('%s: the same commits and parents as git log, in date and topo order', async (name) => {
    const { dir } = repos[name];
    for (const order of ['date', 'topo'] as const) {
      const payload = await graph(dir, `?order=${order}`);
      const expected = fixtureGit(fixtures, dir, ['log', '--branches', '--remotes', '--tags', 'HEAD', `--${order}-order`, '--format=%H %P'])
        .split('\n')
        .map((line) => line.trim().split(' '));

      const shas = payload.commits.map((c) => c.sha);
      expect(payload.order).toBe(order);
      expect(shas).toEqual(expected.map(([sha]) => sha));
      payload.commits.forEach((commit, i) => {
        expect(parentShas(commit, (p) => shas[p])).toEqual(expected[i]?.slice(1));
        // Everything is on one page, and parents always come after their children.
        expect(commit.parents.every((p) => typeof p === 'number' && p > i)).toBe(true);
      });
      expect(payload.page).toEqual({ offset: 0, total: shas.length, next: null });
    }
  });

  it('reports HEAD, the default branch and refs (annotated tags peeled)', async () => {
    const { dir, shas } = repos.merges;
    const payload = await graph(dir);
    expect(payload.head).toEqual({ sha: shas.head, branch: 'main' });
    expect(payload.defaultBranch).toBe('main');
    expect(payload.commits[0]?.sha).toBe(shas.head);
    expect(refCommit(payload, 'v1.0.0')).toBe(shas['merge-login']);
    expect(refCommit(payload, 'v1.1.0')).toBe(shas.head);
    expect(refCommit(payload, 'feature/SHOP-20-search')).toBe(shas['search-tip']);
    expect(payload.refs.find((r) => r.name === 'v1.0.0')?.kind).toBe('tag');
    expect(payload.commits.find((c) => c.sha === shas.octopus)?.parents).toHaveLength(4);
  });

  it('de-duplicates authors after .mailmap and keeps author and commit times apart', async () => {
    const { dir, shas } = repos.people;
    const payload = await graph(dir);
    expect(payload.authors.map((a) => a.email).sort()).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
      'zoe@example.com',
    ]);
    const alice = payload.authors.findIndex((a) => a.email === 'alice@example.com');
    expect(payload.authors[alice]?.name).toBe('Alice Smith');
    expect(payload.commits.find((c) => c.sha === shas['old-identity'])?.author).toBe(alice);
    expect(payload.commits.find((c) => c.sha === shas['cherry-picked'])).toMatchObject({
      authorTime: T0 + 6 * DAY,
      commitTime: T0 + 8 * DAY,
    });
  });

  it('flags the boundary commits of a shallow clone', async () => {
    const { dir } = repos.shallow;
    const payload = await graph(dir);
    const shallow = readFileSync(join(dir, '.git', 'shallow'), 'utf8').split('\n').filter(Boolean);
    const boundary = payload.commits.filter((c) => c.boundary);
    expect(boundary.map((c) => c.sha).sort()).toEqual(shallow.sort());
    expect(boundary.every((c) => c.parents.length === 0)).toBe(true);
  });

  it('handles several roots, detached HEAD, linked worktrees and bare repositories', async () => {
    const multiRoot = await graph(repos.multiRoot.dir);
    expect(multiRoot.commits.filter((c) => c.parents.length === 0)).toHaveLength(3);
    expect(multiRoot.commits.some((c) => c.boundary)).toBe(false);

    const detached = await graph(repos.detached.dir);
    expect(detached.head).toEqual({ sha: repos.detached.shas['detached-at'], branch: null });
    expect(detached.defaultBranch).toBe('main');

    const linked = await graph(repos.worktreeLinked.dir);
    expect(linked.head).toEqual({ sha: repos.worktreeLinked.shas['linked-tip'], branch: 'wt/feature' });
    expect(refCommit(linked, 'main')).toBe(repos.worktree.shas['main-tip']);

    const bare = await graph(repos.branchesOrigin.dir);
    expect(bare.head.branch).toBe('main');
    expect(bare.defaultBranch).toBe('main');
  });

  it('describes upstreams, gone upstreams and remote-only branches; origin/HEAD is not a ref', async () => {
    const { dir, shas } = repos.branches;
    const payload = await graph(dir);
    const byName = new Map(payload.refs.map((r) => [r.name, r]));
    expect(payload.defaultBranch).toBe('main');
    expect(byName.get('main')).toMatchObject({ kind: 'local', upstream: 'origin/main' });
    expect(byName.get('main')?.upstreamGone).toBeUndefined();
    expect(byName.get('bugfix/null-check')).toMatchObject({ upstream: 'origin/bugfix/null-check', upstreamGone: true });
    expect(byName.get('origin/hotfix/typo')).toMatchObject({ kind: 'remote' });
    expect(refCommit(payload, 'origin/main')).toBe(shas['origin-main']);
    expect(byName.has('origin/HEAD')).toBe(false);
  });

  it('returns an empty graph for a repository without commits', async () => {
    expect(await graph(repos.empty.dir)).toEqual({
      snapshot: expect.stringMatching(/^[0-9a-f]{16}$/),
      order: 'date',
      head: { sha: null, branch: 'main' },
      defaultBranch: null,
      authors: [],
      commits: [],
      refs: [],
      page: { offset: 0, total: 0, next: null },
    });
  });

  it('pages with limit and cursor; parents on later pages are given by hash', async () => {
    const { dir } = repos.merges;
    const full = await graph(dir);
    const fullShas = full.commits.map((c) => c.sha);

    const first = await graph(dir, '?limit=5');
    expect(first.page).toEqual({ offset: 0, total: fullShas.length, next: expect.any(String) });
    expect(first.commits.some((c) => c.parents.some((p) => typeof p === 'string'))).toBe(true);

    const pages = [first];
    for (let next = first.page.next; next; ) {
      const page = await graph(dir, `?limit=5&cursor=${encodeURIComponent(next)}`);
      pages.push(page);
      next = page.page.next;
    }
    expect(pages).toHaveLength(Math.ceil(fullShas.length / 5));

    const seen = pages.flatMap((page) => page.commits.map((c) => c.sha));
    expect(seen).toEqual(fullShas);
    for (const page of pages) {
      expect(page.snapshot).toBe(full.snapshot);
      page.commits.forEach((commit, i) => {
        const fullCommit = full.commits[page.page.offset + i] as GraphCommit;
        // Numeric parents are indices into the whole graph, not into the page.
        expect(parentShas(commit, (p) => fullShas[p])).toEqual(parentShas(fullCommit, (p) => fullShas[p]));
        expect(page.authors[commit.author]).toEqual(full.authors[fullCommit.author]);
      });
      expect(page.refs.every((r) => r.commit >= page.page.offset && r.commit < page.page.offset + page.commits.length)).toBe(true);
    }
    expect(pages.flatMap((p) => p.refs).sort((a, b) => a.name.localeCompare(b.name))).toEqual(
      [...full.refs].sort((a, b) => a.name.localeCompare(b.name)),
    );
  });

  it('reuses a page until the refs move, and refuses a cursor from before the move', async () => {
    const before = await graph(copy);
    expect((await graph(copy)).snapshot).toBe(before.snapshot);
    const firstPage = await graph(copy, '?limit=2');
    const cursor = encodeURIComponent(firstPage.page.next ?? '');

    expect((await request(copy, `?limit=2&order=topo&cursor=${cursor}`)).statusCode).toBe(400); // other order
    expect((await request(copy, '?cursor=not-a-cursor')).statusCode).toBe(400);

    fixtureGit(fixtures, copy, ['commit', '-q', '--allow-empty', '-m', 'One more']);
    const after = await graph(copy);
    expect(after.snapshot).not.toBe(before.snapshot);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(after.commits[0]?.subject).toBe('One more');

    const stale = await request(copy, `?limit=2&cursor=${cursor}`);
    expect(stale.statusCode).toBe(409);
    expect(json(stale)).toMatchObject({ error: 'snapshot_changed' });
  });

  it('validates its parameters', async () => {
    const { dir } = repos.linear;
    expect((await request(dir, '?limit=0')).statusCode).toBe(400);
    expect((await request(dir, '?limit=many')).statusCode).toBe(400);
    expect((await request(dir, '?order=sideways')).statusCode).toBe(400);
    const missing = await t.app.inject({ url: '/api/repos/000000000000/graph', headers: { host: HOST, cookie } });
    expect(missing.statusCode).toBe(404);
  });
});
