import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join, relative } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { fixtureGit } from '../../test/fixtures/build.ts';
import { HOST, makeTestApp, signIn, type TestApp } from '../../test/helpers/app.ts';
import type { Repo } from './repos/repo.ts';

/**
 * PLAN.md §11: every endpoint except fetch must leave refs, index and working
 * tree byte-identical. Each new GET route needs a sample request here; the
 * coverage test fails until it has one.
 */
interface Sample {
  repo: Repo;
  /** HEAD's commit, a file it changed, and a merge commit — when the repository has them. */
  head: string | null;
  file: string | null;
  merge: string | null;
}

const SAMPLES: Record<string, (sample: Sample) => string[]> = {
  'GET /api/health': () => ['/api/health'],
  'GET /api/settings': () => ['/api/settings'],
  'GET /api/repos': () => ['/api/repos'],
  'GET /api/repos/:id': ({ repo }) => [`/api/repos/${repo.id}`],
  'GET /api/repos/:id/graph': ({ repo }) => [`/api/repos/${repo.id}/graph`, `/api/repos/${repo.id}/graph?order=topo&limit=3`],
  'GET /api/repos/:id/commits/:sha': ({ repo, head, merge }) => [
    ...(head ? [`/api/repos/${repo.id}/commits/${head}`] : []),
    ...(merge ? [`/api/repos/${repo.id}/commits/${merge}?parent=2`, `/api/repos/${repo.id}/commits/${merge}?parent=cc`] : []),
  ],
  'GET /api/repos/:id/diff': ({ repo, head, file }) =>
    head && file
      ? [`/api/repos/${repo.id}/diff?sha=${head}&path=${encodeURIComponent(file)}`, `/api/repos/${repo.id}/diff?sha=${head}&path=${encodeURIComponent(file)}&ws=1`]
      : [],
};

/** Routes that never touch a repository. */
const EXEMPT = new Set(['GET /auth']);

const fixtures = inject('fixtures');

let t: TestApp;
let cookie: string;
let samples: Sample[];

beforeAll(async () => {
  t = await makeTestApp(Object.values(fixtures.repos).map((repo) => repo.dir));
  cookie = await signIn(t);
  samples = t.repos.map((repo) => {
    const git = (...args: string[]) => fixtureGit(fixtures, repo.path, args);
    let head: string | null = null;
    try {
      head = git('rev-parse', '-q', '--verify', 'HEAD^{commit}');
    } catch {
      // no commits yet
    }
    const file = head ? (git('diff-tree', '-r', '-z', '--name-only', '--no-commit-id', '--root', head).split('\0')[0] ?? null) : null;
    const merge = git('rev-list', '-n1', '--min-parents=2', '--all') || null;
    return { repo, head, file: file || null, merge };
  });
});
afterAll(() => t.app.close());

describe('read-only guarantee', () => {
  it('has a sample request for every API route', () => {
    const routes = t.app.gittreeRoutes.filter((r) => !r.startsWith('HEAD ') && !r.endsWith('*') && !EXEMPT.has(r));
    const uncovered = routes.filter((route) => !(route in SAMPLES));
    expect(uncovered, 'add a read-only sample for these routes').toEqual([]);
  });

  it('leaves every fixture repository byte-identical', async () => {
    const before = snapshot(fixtures.root);
    for (const sample of samples) {
      for (const urls of Object.values(SAMPLES)) {
        for (const url of urls(sample)) {
          const response = await t.app.inject({ url, headers: { host: HOST, cookie } });
          expect(response.statusCode, `${url} for ${sample.repo.name}`).toBe(200);
        }
      }
    }
    expect(snapshot(fixtures.root)).toEqual(before);
  });
});

/** Content hash of every file, symlink target and directory under `root`. */
function snapshot(root: string): Map<string, string> {
  const entries = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const key = relative(root, full);
      if (entry.isSymbolicLink()) {
        entries.set(key, `symlink → ${readlinkSync(full)}`);
      } else if (entry.isDirectory()) {
        entries.set(`${key}/`, 'dir');
        walk(full);
      } else {
        entries.set(key, createHash('sha256').update(readFileSync(full)).digest('hex'));
      }
    }
  };
  walk(root);
  return entries;
}
