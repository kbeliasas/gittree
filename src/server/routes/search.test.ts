import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { HOST, json, makeTestApp, signIn, type TestApp } from '../../../test/helpers/app.ts';
import { NO_LAZY_FETCH_SUPPORTED } from '../../../test/helpers/git.ts';
import { SearchEvent, type TreePayload } from '../../shared/api.ts';

const fixtures = inject('fixtures');
const { repos } = fixtures;

let t: TestApp;
let cookie: string;

beforeAll(async () => {
  const dirs = [repos.conflicts, repos.files, repos.merges, repos.empty, repos.partial].map((repo) => repo.dir);
  t = await makeTestApp(dirs.filter((dir) => NO_LAZY_FETCH_SUPPORTED || dir !== repos.partial.dir));
  cookie = await signIn(t);
});
afterAll(() => t.app.close());

const idOf = (dir: string) => t.repos.find((r) => r.path === dir)!.id;
const get = (dir: string, path: string, query: Record<string, string>) =>
  t.app.inject({ url: `/api/repos/${idOf(dir)}/${path}?${new URLSearchParams(query)}`, headers: { host: HOST, cookie } });

/** The stream's events, checked against the shared schema. */
async function search(dir: string, query: Record<string, string>): Promise<SearchEvent[]> {
  const response = await get(dir, 'search', query);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
  expect(response.body.endsWith('\n')).toBe(true);
  return response.body
    .trimEnd()
    .split('\n')
    .map((line) => SearchEvent.parse(JSON.parse(line)));
}

/** The matched commits, by fixture label where they have one (else by hash), sorted. */
async function matches(name: 'conflicts' | 'files' | 'merges' | 'partial', query: Record<string, string>): Promise<string[]> {
  const repo = repos[name];
  const events = await search(repo.dir, query);
  expect(events.at(-1)).toMatchObject({ type: 'done' });
  const labelOf = new Map(Object.entries(repo.shas).map(([label, sha]) => [sha, label]));
  return events
    .flatMap((e) => (e.type === 'progress' ? e.matches : []))
    .map((sha) => labelOf.get(sha) ?? sha)
    .sort();
}

describe('GET /api/repos/:id/search — path:', () => {
  it('finds the commits that changed a file, merges only when they changed it themselves', async () => {
    // The merge resolved a conflict in retry.ts, merged limits.ts from both sides, and edited NOTES.md itself.
    expect(await matches('conflicts', { kind: 'path', value: 'src/retry.ts' })).toEqual(['conflict-merge', 'feature-tip', 'main-side', 'root']);
    expect(await matches('conflicts', { kind: 'path', value: 'src/limits.ts' })).toEqual(['conflict-merge', 'feature-tip', 'head', 'main-side', 'root']);
    expect(await matches('conflicts', { kind: 'path', value: 'NOTES.md' })).toEqual(['conflict-merge', 'root']);
    // A merge that only brings a branch's README change in doesn't count.
    const readme = await search(repos.merges.dir, { kind: 'path', value: 'README.md' });
    expect(readme.flatMap((e) => (e.type === 'progress' ? e.matches : []))).toHaveLength(2);
  });

  it('takes folders, odd names and leading slashes literally; renames are a deletion plus an addition', async () => {
    expect(await matches('conflicts', { kind: 'path', value: 'src' })).toEqual(['conflict-merge', 'feature-tip', 'head', 'main-side', 'root']);
    expect(await matches('conflicts', { kind: 'path', value: '/NOTES.md' })).toEqual(['conflict-merge', 'root']);
    expect(await matches('files', { kind: 'path', value: 'odd/"quoted".txt' })).toEqual(['root']);
    expect(await matches('files', { kind: 'path', value: 'with space/file name.txt' })).toEqual(['root']);
    expect(await matches('files', { kind: 'path', value: 'src/日本語' })).toEqual(['root']);
    expect(await matches('files', { kind: 'path', value: 'src/auth.ts' })).toEqual(['rename', 'root']);
    expect(await matches('files', { kind: 'path', value: 'src/api/login.ts' })).toEqual(['head', 'rename']);
    expect(await matches('files', { kind: 'path', value: 'sr' })).toEqual([]);
  });

  it('treats values with * ? [ as git globs: * stays in one folder, ** crosses folders', async () => {
    expect(await matches('files', { kind: 'path', value: '*.md' })).toEqual(['root']); // README.md only
    expect(await matches('files', { kind: 'path', value: '**/*.md' })).toEqual(['root', 'symlink']);
    expect(await matches('files', { kind: 'path', value: 'legacy/*.js' })).toEqual(['delete', 'move']);
    const script = await matches('files', { kind: 'path', value: 'scripts/build.sh' });
    expect(script).toHaveLength(2); // added, then made executable
    expect(await matches('files', { kind: 'path', value: 'scripts/build.s?' })).toEqual(script);
  });
});

describe('GET /api/repos/:id/search — content: and regex:', () => {
  it('content: finds commits that change how often a text occurs, case-sensitively', async () => {
    expect(await matches('conflicts', { kind: 'content', value: 'attempts' })).toEqual(['root']); // later commits keep one
    expect(await matches('conflicts', { kind: 'content', value: 'attempts: 5' })).toEqual(['feature-tip']);
    expect(await matches('conflicts', { kind: 'content', value: 'ATTEMPTS' })).toEqual([]);
    // Merges aren't searched: only the conflict resolution introduced "attempts: 4".
    expect(await matches('conflicts', { kind: 'content', value: 'attempts: 4' })).toEqual([]);
  });

  it('regex: finds commits whose changed lines match, with i for ignoring case', async () => {
    expect(await matches('conflicts', { kind: 'regex', value: 'attempts: [0-9]' })).toEqual(['feature-tip', 'main-side', 'root']);
    expect(await matches('conflicts', { kind: 'regex', value: 'ATTEMPTS: [0-9]' })).toEqual([]);
    expect(await matches('conflicts', { kind: 'regex', value: 'ATTEMPTS: [0-9]', flags: 'i' })).toEqual(['feature-tip', 'main-side', 'root']);
  });

  it('answers 400 for a regex git rejects, before streaming anything', async () => {
    const response = await get(repos.conflicts.dir, 'search', { kind: 'regex', value: 'attempts: (' });
    expect(response.statusCode).toBe(400);
    expect(json(response)).toMatchObject({ error: 'bad_regex', message: expect.stringContaining('POSIX extended') });
  });

  it.runIf(NO_LAZY_FETCH_SUPPORTED)('in a partial clone: path search works, content search answers 409 objects_missing', async () => {
    expect(await matches('partial', { kind: 'path', value: 'NOTES.md' })).toEqual(['conflict-merge', 'root']);
    for (const kind of ['content', 'regex']) {
      const response = await get(repos.partial.dir, 'search', { kind, value: 'attempts' });
      expect(response.statusCode).toBe(409);
      expect(json(response)).toMatchObject({ error: 'objects_missing', message: expect.stringContaining('path: search still works') });
    }
  });
});

describe('GET /api/repos/:id/search — the stream', () => {
  it('reports progress over the graph page and ends with done', async () => {
    const events = await search(repos.merges.dir, { kind: 'path', value: 'notes' });
    expect(events[0]).toMatchObject({ type: 'progress', total: 24 });
    expect(events.at(-1)).toEqual({ type: 'done', searched: 24, total: 24 });
    // Limited to the graph page, like the graph.
    const limited = await search(repos.merges.dir, { kind: 'path', value: 'notes', limit: '5' });
    expect(limited.at(-1)).toEqual({ type: 'done', searched: 5, total: 5 });
  });

  it('answers again from its cache', async () => {
    const query = { kind: 'path', value: 'src/limits.ts', order: 'topo' };
    const first = await search(repos.conflicts.dir, query);
    const again = await search(repos.conflicts.dir, query);
    const all = (events: SearchEvent[]) => events.flatMap((e) => (e.type === 'progress' ? e.matches : [])).sort();
    expect(all(again)).toEqual(all(first));
    expect(again).toHaveLength(2); // one progress event with everything, then done
  });

  it('finishes at once for a repository without commits', async () => {
    expect(await search(repos.empty.dir, { kind: 'content', value: 'x' })).toEqual([
      { type: 'progress', searched: 0, total: 0, matches: [] },
      { type: 'done', searched: 0, total: 0 },
    ]);
  });

  it('validates its parameters', async () => {
    const status = async (query: Record<string, string>) => (await get(repos.conflicts.dir, 'search', query)).statusCode;
    expect(await status({ kind: 'path', value: '' })).toBe(400);
    expect(await status({ kind: 'author', value: 'x' })).toBe(400);
    expect(await status({ kind: 'regex', value: 'x', flags: 'g' })).toBe(400);
    expect(await status({ kind: 'content', value: 'a\0b' })).toBe(400);
    expect(await status({ kind: 'path', value: 'x'.repeat(1001) })).toBe(400);
  });
});

describe('GET /api/repos/:id/tree', () => {
  it('lists every file at a commit', async () => {
    const response = await get(repos.conflicts.dir, 'tree', { at: repos.conflicts.shas.head! });
    expect(response.statusCode).toBe(200);
    expect(json<TreePayload>(response)).toEqual({ at: repos.conflicts.shas.head, paths: ['NOTES.md', 'src/limits.ts', 'src/retry.ts'] });

    const files = json<TreePayload>(await get(repos.files.dir, 'tree', { at: repos.files.shas.head! }));
    expect(files.paths).toContain('odd/new\nline.txt'); // NUL-separated, never quoted
    expect(files.paths).toContain('docs/naïve café.md');
  });

  it('answers 404 for a commit the repository lacks, and 400 for something that is no hash', async () => {
    expect((await get(repos.conflicts.dir, 'tree', { at: 'a'.repeat(40) })).statusCode).toBe(404);
    expect((await get(repos.conflicts.dir, 'tree', { at: 'HEAD' })).statusCode).toBe(400);
  });
});
