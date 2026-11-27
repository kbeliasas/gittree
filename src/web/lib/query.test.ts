import { describe, expect, it } from 'vitest';

import type { RefKind } from '../../shared/api.ts';
import { jiraMatcher } from './jira.ts';
import {
  addTerm,
  buildSearchIndex,
  isApplied,
  matchQuery,
  parseDateBound,
  parseQuery,
  pathSuggestions,
  quoteValue,
  removeTerm,
  serverTermKey,
  suggest,
  toggleJira,
  type SuggestionSource,
} from './query.ts';

const brief = (query: string) => parseQuery(query).map(({ key, value, negate, error }) => ({ key, value, negate, ...(error ? { error: true } : {}) }));

describe('parseQuery', () => {
  it('splits free text and key:value terms, with positions', () => {
    expect(parseQuery('author:alice  login')).toEqual([
      { key: 'author', value: 'alice', negate: false, quoted: false, start: 0, end: 12 },
      { key: 'text', value: 'login', negate: false, quoted: false, start: 14, end: 19 },
    ]);
  });

  it('reads quoted values and phrases, with \\" and \\\\ escapes', () => {
    expect(brief('author:"Alice Smith" "fix login" "say \\"hi\\" \\\\o/"')).toEqual([
      { key: 'author', value: 'Alice Smith', negate: false },
      { key: 'text', value: 'fix login', negate: false },
      { key: 'text', value: 'say "hi" \\o/', negate: false },
    ]);
    expect(parseQuery('author:"Alice Sm')[0]).toMatchObject({ value: 'Alice Sm', quoted: true, end: 16 }); // still typing
  });

  it('negates terms with a leading minus; a lone minus is text', () => {
    expect(brief('-author:bob -wip -"draft pr" - x')).toEqual([
      { key: 'author', value: 'bob', negate: true },
      { key: 'text', value: 'wip', negate: true },
      { key: 'text', value: 'draft pr', negate: true },
      { key: 'text', value: '-', negate: false },
      { key: 'text', value: 'x', negate: false },
    ]);
  });

  it('takes keys in any case; unknown keys are text, like conventional-commit prefixes', () => {
    expect(brief('Author:alice fix:null-check feat(ui):')).toEqual([
      { key: 'author', value: 'alice', negate: false },
      { key: 'text', value: 'fix:null-check', negate: false },
      { key: 'text', value: 'feat(ui):', negate: false },
    ]);
  });

  it('reads regex:/…/flags, spaces and \\/ included', () => {
    expect(parseQuery('regex:/foo bar\\/baz/i x')[0]).toMatchObject({ key: 'regex', value: 'foo bar/baz', flags: 'i', quoted: true, end: 21 });
    expect(parseQuery('regex:/open')[0]).toMatchObject({ value: 'open', error: 'Close the pattern with /' });
  });

  it('flags values it cannot use, and leaves unfinished ones out quietly', () => {
    expect(brief('after:soon before:2025-02-30 merges:maybe regex:/x/g path:src')).toEqual([
      { key: 'after', value: 'soon', negate: false, error: true },
      { key: 'before', value: '2025-02-30', negate: false, error: true },
      { key: 'merges', value: 'maybe', negate: false, error: true },
      { key: 'regex', value: 'x', negate: false, error: true }, // only the i flag
      { key: 'path', value: 'src', negate: false },
    ]);
    const [unfinished] = parseQuery('author:');
    expect(unfinished).toMatchObject({ key: 'author', value: '' });
    expect(unfinished?.error).toBeUndefined();
    expect(isApplied(unfinished!)).toBe(false);
  });
});

describe('parseDateBound', () => {
  const now = new Date(2025, 5, 15, 14, 30); // 15 June 2025, 14:30 local time
  const local = (...args: [number, number, number]) => new Date(...args).getTime() / 1000;

  it('reads dates as the start of that day, local time', () => {
    expect(parseDateBound('2025-03-01', now)).toBe(local(2025, 2, 1));
    expect(parseDateBound('today', now)).toBe(local(2025, 5, 15));
    expect(parseDateBound('Yesterday', now)).toBe(local(2025, 5, 14));
    expect(parseDateBound('2025-02-29', now)).toBeNull();
    expect(parseDateBound('2025-3-1', now)).toBeNull();
  });

  it('reads ages back from now', () => {
    const at = (date: Date) => Math.floor(date.getTime() / 1000);
    expect(parseDateBound('3d', now)).toBe(at(new Date(2025, 5, 12, 14, 30)));
    expect(parseDateBound('2w', now)).toBe(at(new Date(2025, 5, 1, 14, 30)));
    expect(parseDateBound('6m', now)).toBe(at(new Date(2024, 11, 15, 14, 30)));
    expect(parseDateBound('6mo', now)).toBe(parseDateBound('6m', now));
    expect(parseDateBound('1y', now)).toBe(at(new Date(2024, 5, 15, 14, 30)));
    expect(parseDateBound('3 weeks', now)).toBeNull();
  });
});

const DAY = 86_400;
const T = new Date(2025, 0, 6, 9).getTime() / 1000;
const NOW = new Date((T + 20 * DAY) * 1000);

/** A small history, newest first. */
const ROWS = [
  { sha: 'aaaa0000', subject: 'Release 1.1.0', author: 0, time: T + 15 * DAY, line: 'main' },
  { sha: 'bbbb1111', subject: 'SHOP-20 Search results', author: 3, time: T + 14 * DAY, line: 'feature/SHOP-20-search' },
  { sha: 'cccc2222', subject: "Merge branch 'feature/SHOP-15-cart'", author: 1, time: T + 12 * DAY, line: 'main', merge: true },
  { sha: 'dddd3333', subject: 'Cart page', author: 2, time: T + 11 * DAY, line: 'feature/SHOP-15-cart' },
  { sha: 'eeee4444', subject: 'Login API client', body: 'Talks to /api/session.\n\nRefs OPS-7.', author: 1, time: T + 3 * DAY, line: 'main' },
  { sha: 'abcd5555', subject: 'Initial commit', author: 0, time: T, line: 'main' },
];
const AUTHORS = [
  { name: 'Bob Jones', email: 'bob@example.com' },
  { name: 'Alice Smith', email: 'alice@example.com' },
  { name: 'Carol Nguyen', email: 'carol@example.com' },
  { name: 'Zoë Ångström', email: 'zoe@example.com' },
];
const REFS = new Map<number, Array<{ name: string; kind: RefKind }>>([
  [0, [{ name: 'main', kind: 'local' }, { name: 'origin/main', kind: 'remote' }, { name: 'v1.1.0', kind: 'tag' }]],
  [1, [{ name: 'feature/SHOP-20-search', kind: 'local' }, { name: 'origin/release/2.x', kind: 'remote' }]],
  [3, [{ name: 'release/1.x', kind: 'local' }]],
]);

function index(bodies = true) {
  return buildSearchIndex({
    shas: ROWS.map((r) => r.sha),
    subjects: ROWS.map((r) => r.subject),
    bodies: bodies ? Object.fromEntries(ROWS.filter((r) => r.body).map((r) => [r.sha, r.body!])) : null,
    authorOf: ROWS.map((r) => r.author),
    authors: AUTHORS,
    authorTime: ROWS.map((r) => r.time),
    merge: ROWS.map((r) => (r.merge ? 1 : 0)),
    refsAt: REFS,
    lineName: (row) => ROWS[row]!.line,
    jira: jiraMatcher(['SHOP', 'OPS']),
  });
}

/** Subjects of the rows a query selects; null when it selects by nothing. */
function search(query: string, options: { bodies?: boolean; server?: Record<string, number[]> } = {}): string[] | null {
  const server = new Map(
    Object.entries(options.server ?? {}).map(([key, rows]) => {
      const mask = new Uint8Array(ROWS.length);
      for (const row of rows) mask[row] = 1;
      return [key, mask];
    }),
  );
  const match = matchQuery(parseQuery(query), index(options.bodies ?? true), NOW, server);
  if (!match) return null;
  expect(match.count).toBe(match.rows.reduce((sum, v) => sum + v, 0));
  return ROWS.filter((_, row) => match.rows[row] === 1).map((r) => r.subject);
}

describe('matchQuery', () => {
  it('matches free text in subjects and bodies, ignoring case', () => {
    expect(search('cart')).toEqual(["Merge branch 'feature/SHOP-15-cart'", 'Cart page']);
    expect(search('API/SESSION')).toEqual(['Login API client']);
    expect(search('API/SESSION', { bodies: false })).toEqual([]); // bodies still loading
  });

  it('matches hash prefixes and ref names', () => {
    expect(search('abcd')).toEqual(['Initial commit']);
    expect(search('v1.1')).toEqual(['Release 1.1.0']);
    expect(search('release/1')).toEqual(['Cart page']);
  });

  it('needs every word, but either value of a repeated key', () => {
    expect(search('login client')).toEqual(['Login API client']);
    expect(search('login page')).toEqual([]);
    expect(search('author:carol author:zoe')).toEqual(['SHOP-20 Search results', 'Cart page']);
    expect(search('author:alice merges:only')).toEqual(["Merge branch 'feature/SHOP-15-cart'"]);
  });

  it('matches authors by name or email', () => {
    expect(search('author:"alice smith"')).toEqual(["Merge branch 'feature/SHOP-15-cart'", 'Login API client']);
    expect(search('author:bob@')).toEqual(['Release 1.1.0', 'Initial commit']);
    expect(search('author:ångström')).toEqual(['SHOP-20 Search results']);
  });

  it('leaves out what negated terms match', () => {
    expect(search('-author:bob -author:alice')).toEqual(['SHOP-20 Search results', 'Cart page']);
    expect(search('-merges:none')).toEqual(["Merge branch 'feature/SHOP-15-cart'"]);
    expect(search('-shop')).toEqual(['Release 1.1.0', 'Cart page', 'Login API client', 'Initial commit']);
  });

  it('compares author dates: after is inclusive, before is not', () => {
    expect(search('after:2025-01-20')).toEqual(['Release 1.1.0', 'SHOP-20 Search results']);
    expect(search('before:2025-01-18')).toEqual(['Cart page', 'Login API client', 'Initial commit']);
    expect(search('after:1w')).toEqual(['Release 1.1.0', 'SHOP-20 Search results']);
    expect(search('after:2025-01-10 before:2025-01-19')).toEqual(["Merge branch 'feature/SHOP-15-cart'", 'Cart page']);
  });

  it('matches refs by name or glob, remote branches also without their remote', () => {
    expect(search('ref:main')).toEqual(['Release 1.1.0']);
    expect(search('ref:release/*')).toEqual(['SHOP-20 Search results', 'Cart page']);
    expect(search('ref:origin/release/?.x')).toEqual(['SHOP-20 Search results']);
    expect(search('ref:v1.*')).toEqual(['Release 1.1.0']);
    expect(search('ref:release')).toEqual([]);
  });

  it('matches Jira keys in messages and branch names, or a whole project', () => {
    expect(search('jira:SHOP-15')).toEqual(["Merge branch 'feature/SHOP-15-cart'", 'Cart page']);
    expect(search('jira:shop-1')).toEqual([]); // whole keys only
    expect(search('jira:OPS')).toEqual(['Login API client']);
    expect(search('jira:SHOP -jira:SHOP-20')).toEqual(["Merge branch 'feature/SHOP-15-cart'", 'Cart page']);
  });

  it('uses what the server searches found so far; nothing yet matches nothing', () => {
    const found = { [serverTermKey({ key: 'path', value: 'src/cart' })]: [3, 4] };
    expect(search('path:src/cart', { server: found })).toEqual(['Cart page', 'Login API client']);
    expect(search('path:src/cart')).toEqual([]); // still searching
    expect(search('-path:src/cart merges:none', { server: found })).toEqual(['Release 1.1.0', 'SHOP-20 Search results', 'Initial commit']);
    expect(search('path:src/cart path:docs', { server: { ...found, [serverTermKey({ key: 'path', value: 'docs' })]: [0] } })).toEqual([
      'Release 1.1.0',
      'Cart page',
      'Login API client',
    ]);
    // regex: flags are part of the search; content: and path: have none.
    expect(serverTermKey({ key: 'regex', value: 'a', flags: 'i' })).not.toBe(serverTermKey({ key: 'regex', value: 'a', flags: '' }));
    expect(serverTermKey({ key: 'regex', value: 'a', flags: '' })).toBe(serverTermKey({ key: 'regex', value: 'a' }));
  });

  it('selects by nothing when no term can be used', () => {
    expect(search('')).toBeNull();
    expect(search('author: after:someday')).toBeNull();
    expect(search('regex:/x/g')).toBeNull();
    expect(search('regex:/x/g cart')).toEqual(["Merge branch 'feature/SHOP-15-cart'", 'Cart page']); // the rest still applies
  });
});

describe('editing helpers', () => {
  it('quotes values that need it', () => {
    expect(quoteValue('alice')).toBe('alice');
    expect(quoteValue('Alice Smith')).toBe('"Alice Smith"');
    expect(quoteValue('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('removes and adds terms', () => {
    const query = 'author:alice  "fix login" -wip';
    const [, phrase] = parseQuery(query);
    expect(removeTerm(query, phrase!)).toBe('author:alice -wip');
    expect(removeTerm('wip', parseQuery('wip')[0]!)).toBe('');
    expect(addTerm('author:alice ', 'jira:SHOP-1')).toBe('author:alice jira:SHOP-1');
    expect(addTerm('', 'jira:SHOP-1')).toBe('jira:SHOP-1');
  });

  it('toggles a Jira key', () => {
    expect(toggleJira('login', 'SHOP-12')).toBe('login jira:SHOP-12');
    expect(toggleJira('jira:shop-12 login', 'SHOP-12')).toBe('login');
    expect(toggleJira('-jira:SHOP-12', 'SHOP-12')).toBe('-jira:SHOP-12 jira:SHOP-12');
  });
});

describe('suggest', () => {
  const source: SuggestionSource = {
    authors: [
      { name: 'Alice Smith', email: 'alice@example.com', commits: 2 },
      { name: 'Carol Nguyen', email: 'carol@example.com', commits: 1 },
      { name: 'Bob Jones', email: 'bob@example.com', commits: 2 },
    ],
    refs: [
      { name: 'v1.1.0', kind: 'tag' },
      { name: 'origin/feature/x', kind: 'remote' },
      { name: 'feature/x', kind: 'local' },
    ],
    jira: [
      { key: 'SHOP-2', commits: 1 },
      { key: 'SHOP-10', commits: 3 },
      { key: 'SHOP-1', commits: 1 },
    ],
    paths: ['README.md', 'docs/guide.md', 'src/api/login.ts', 'src/api/session.ts', 'src/app.ts', 'with space/file.txt'],
  };
  const labels = (query: string, caret = query.length) => suggest(query, caret, source).items.map((s) => s.label);

  it('lists the keys in an empty bar, and completes key names', () => {
    expect(labels('')).toEqual(['author:', 'after:', 'before:', 'ref:', 'jira:', 'merges:', 'path:', 'content:', 'regex:']);
    expect(labels('a')).toEqual(['author:', 'after:']);
    expect(labels('-a')).toEqual(['-author:', '-after:']);
    expect(labels('author')).toEqual(['author:']);
    expect(labels('login')).toEqual([]);
    expect(labels('login ')).toEqual([]); // nothing between terms
  });

  it('completes authors (most commits first), refs (branches first) and Jira keys', () => {
    expect(labels('author:')).toEqual(['Alice Smith', 'Bob Jones', 'Carol Nguyen']);
    expect(suggest('x author:car', 12, source)).toEqual({
      items: [{ label: 'Carol Nguyen', detail: 'carol@example.com · 1 commit', insert: 'author:"Carol Nguyen" ' }],
      start: 2,
      end: 12,
    });
    expect(labels('author:"ali')).toEqual(['Alice Smith']);
    expect(labels('ref:')).toEqual(['feature/x', 'origin/feature/x', 'v1.1.0']);
    expect(labels('jira:shop-1')).toEqual(['SHOP-10', 'SHOP-1']);
    expect(suggest('-jira:SHOP-1', 12, source).items[0]?.insert).toBe('-jira:SHOP-10 ');
  });

  it('offers merges values and date shortcuts', () => {
    expect(labels('merges:')).toEqual(['only', 'none']);
    expect(labels('after:1')).toEqual(['1w', '1m', '1y']);
    expect(suggest('before:1', 8, source).items.find((s) => s.label === '1y')?.detail).toBe('More than a year ago');
  });

  it('completes paths like a shell: the typed folder first, then anything containing the text', () => {
    expect(labels('path:')).toEqual(['docs/', 'src/', 'with space/', 'README.md']);
    expect(labels('path:src/')).toEqual(['src/api/', 'src/app.ts']);
    expect(labels('path:src/a')).toEqual(['src/api/', 'src/app.ts']);
    expect(labels('path:src/api/s')).toEqual(['src/api/session.ts']);
    expect(labels('path:login')).toEqual(['src/api/login.ts']); // no such folder entry: anywhere
    expect(labels('path:**/*.ts')).toEqual([]); // globs get none
    // A folder keeps the term open; a file (or a folder that needs quotes) closes it.
    expect(suggest('path:sr', 7, source).items[0]?.insert).toBe('path:src/');
    expect(suggest('-path:src/api/l', 15, source).items[0]?.insert).toBe('-path:src/api/login.ts ');
    expect(suggest('path:wi', 7, source).items[0]?.insert).toBe('path:"with space/" ');
    expect(pathSuggestions('x', [])).toEqual([]);
  });

  it('replaces the whole term under the caret, and stays quiet once a value is complete', () => {
    expect(suggest('author:al login', 9, source)).toMatchObject({ start: 0, end: 9 });
    expect(labels('merges:only')).toEqual([]);
    expect(labels('author:"Bob Jones"')).toEqual([]);
  });
});
