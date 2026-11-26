import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join, relative } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { HOST, makeTestApp, signIn, type TestApp } from '../../test/helpers/app.ts';
import type { Repo } from './repos/repo.ts';

/**
 * PLAN.md §11: every endpoint except fetch must leave refs, index and working
 * tree byte-identical. Each new GET route needs a sample request here; the
 * coverage test fails until it has one.
 */
const SAMPLES: Record<string, (repo: Repo) => string[]> = {
  'GET /api/health': () => ['/api/health'],
  'GET /api/repos': () => ['/api/repos'],
  'GET /api/repos/:id': (repo) => [`/api/repos/${repo.id}`],
};

/** Routes that never touch a repository. */
const EXEMPT = new Set(['GET /auth']);

const fixtures = inject('fixtures');

let t: TestApp;
let cookie: string;

beforeAll(async () => {
  t = await makeTestApp(Object.values(fixtures.repos).map((repo) => repo.dir));
  cookie = await signIn(t);
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
    for (const repo of t.repos) {
      for (const sample of Object.values(SAMPLES)) {
        for (const url of sample(repo)) {
          const response = await t.app.inject({ url, headers: { host: HOST, cookie } });
          expect(response.statusCode, `${url} for ${repo.name}`).toBe(200);
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
