import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join, relative } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { fixtureGit } from '../../test/fixtures/build.ts';
import { HOST, makeTestApp, signIn, type TestApp } from '../../test/helpers/app.ts';
import { NO_LAZY_FETCH_SUPPORTED } from '../../test/helpers/git.ts';
import type { Repo } from './repos/repo.ts';

/**
 * PLAN.md §11: every endpoint except fetch must leave every file of every
 * repository byte-identical: refs, index, working tree and object store. That
 * includes partial clones, where git would download the file contents they lack
 * whenever a command needs them; routes that need those contents answer 409
 * `objects_missing` instead. Each new GET route needs a sample request here; the
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
const PARTIAL_CLONES: ReadonlySet<string> = new Set([fixtures.repos.partial.dir, fixtures.repos.partialBare.dir]);

let t: TestApp;
let cookie: string;
let samples: Sample[];

beforeAll(async () => {
  // Older git ignores GIT_NO_LAZY_FETCH and would download into the partial clones.
  const dirs = Object.values(fixtures.repos).map((repo) => repo.dir);
  t = await makeTestApp(dirs.filter((dir) => NO_LAZY_FETCH_SUPPORTED || !PARTIAL_CLONES.has(dir)));
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
    const missing: string[] = [];
    for (const sample of samples) {
      for (const urls of Object.values(SAMPLES)) {
        for (const url of urls(sample)) {
          const response = await t.app.inject({ url, headers: { host: HOST, cookie } });
          const what = `${url} for ${sample.repo.name}`;
          if (PARTIAL_CLONES.has(sample.repo.path) && response.statusCode === 409) {
            expect(response.json<{ error: string }>().error, what).toBe('objects_missing');
            missing.push(what);
            continue;
          }
          expect(response.statusCode, what).toBe(200);
        }
      }
    }
    expect(changes(before, snapshot(fixtures.root)), 'files written under the fixtures root').toEqual([]);
    // Some requests did need contents the partial clones lack, and git didn't download them.
    if (NO_LAZY_FETCH_SUPPORTED) expect(missing, 'requests answered 409 objects_missing').not.toEqual([]);
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

/** Paths that differ between two snapshots: `+` added, `~` changed, `-` removed. */
function changes(before: Map<string, string>, after: Map<string, string>): string[] {
  const lines: string[] = [];
  for (const [path, hash] of after) {
    if (!before.has(path)) lines.push(`+ ${path}`);
    else if (before.get(path) !== hash) lines.push(`~ ${path}`);
  }
  for (const path of before.keys()) if (!after.has(path)) lines.push(`- ${path}`);
  return lines;
}
