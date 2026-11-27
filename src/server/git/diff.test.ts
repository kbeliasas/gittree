import { describe, expect, it } from 'vitest';

import { parseCombinedRaw, parsePatch, parseRawNumstat, splitCombinedPatch, unquotePath } from './diff.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const ZERO = '0'.repeat(40);
const z = (...tokens: string[]) => `${tokens.join('\0')}\0`;

describe('parseRawNumstat', () => {
  it('pairs raw records with numstat records, including renames', () => {
    const output = z(
      `:100644 100644 ${A} ${B} R094`,
      'src/auth.ts',
      'src/api/login.ts',
      `:100644 100644 ${A} ${C} M`,
      'README.md',
      '1\t1\t',
      'src/auth.ts',
      'src/api/login.ts',
      '3\t0\tREADME.md',
    );
    expect(parseRawNumstat(output)).toEqual([
      {
        status: 'renamed',
        similarity: 94,
        path: 'src/api/login.ts',
        oldPath: 'src/auth.ts',
        oldMode: '100644',
        newMode: '100644',
        oldObject: A,
        newObject: B,
        additions: 1,
        deletions: 1,
      },
      {
        status: 'modified',
        path: 'README.md',
        oldMode: '100644',
        newMode: '100644',
        oldObject: A,
        newObject: C,
        additions: 3,
        deletions: 0,
      },
    ]);
  });

  it('keeps tabs, newlines, quotes and colons in paths verbatim', () => {
    const paths = ['odd/tab\there.txt', 'odd/new\nline.txt', 'odd/"quoted".txt', ':colon'];
    const output = z(
      ...paths.flatMap((path) => [`:000000 100644 ${ZERO} ${A} A`, path]),
      ...paths.map((path) => `1\t0\t${path}`),
    );
    expect(parseRawNumstat(output).map((c) => [c.status, c.path])).toEqual(paths.map((path) => ['added', path]));
  });

  it('marks binary files, deletions, mode changes and symlinks', () => {
    const output = z(
      `:100644 100644 ${A} ${B} M`,
      'assets/logo.png',
      `:100644 000000 ${A} ${ZERO} D`,
      'gone.js',
      `:100644 100755 ${A} ${A} M`,
      'build.sh',
      `:000000 120000 ${ZERO} ${C} A`,
      'link.md',
      '-\t-\tassets/logo.png',
      '0\t8\tgone.js',
      '0\t0\tbuild.sh',
      '1\t0\tlink.md',
    );
    const changes = parseRawNumstat(output);
    expect(changes[0]).toMatchObject({ additions: null, deletions: null });
    expect(changes[1]).toMatchObject({ status: 'deleted', newMode: '000000', newObject: ZERO, deletions: 8 });
    expect(changes[2]).toMatchObject({ oldMode: '100644', newMode: '100755', additions: 0, deletions: 0 });
    expect(changes[3]).toMatchObject({ status: 'added', newMode: '120000' });
  });

  it('returns nothing for an empty diff and refuses mismatched output', () => {
    expect(parseRawNumstat('')).toEqual([]);
    expect(() => parseRawNumstat(z(`:100644 100644 ${A} ${B} M`, 'a.txt', '1\t1\tb.txt'))).toThrow(/no raw record/);
    expect(() => parseRawNumstat(z(':100644 M', 'a.txt'))).toThrow(/unexpected raw diff record/);
  });
});

describe('combined diffs', () => {
  const raw = z(
    `::100644 100644 100644 ${A} ${B} ${C} MM`,
    'clean3way.txt',
    `::100644 100644 100644 ${A} ${B} ${C} MM`,
    'tab\tname.txt',
  );
  const patch = [
    'diff --cc "tab\\tname.txt"',
    'index a8e1fca,161750b..b86a260',
    '--- "a/tab\\tname.txt"',
    '+++ "b/tab\\tname.txt"',
    '@@@ -1,5 -1,5 +1,5 @@@ export const RETRY = {',
    '  a',
    '- B-main',
    ' -B-feat',
    '++B-res',
    '  c',
    '  d',
    '  e',
    '',
  ].join('\n');

  it('reads raw records with one mode, object and status per parent', () => {
    const { changes, rest } = parseCombinedRaw(`${raw}\0${patch}`);
    expect(changes).toEqual([
      { path: 'clean3way.txt', parentModes: ['100644', '100644'], newMode: '100644', parentObjects: [A, B], newObject: C, statuses: 'MM' },
      { path: 'tab\tname.txt', parentModes: ['100644', '100644'], newMode: '100644', parentObjects: [A, B], newObject: C, statuses: 'MM' },
    ]);
    expect(rest).toBe(patch);
    expect(parseCombinedRaw('')).toEqual({ changes: [], rest: '' });
  });

  it('splits the patch per file and unquotes the paths', () => {
    const sections = splitCombinedPatch(patch, 2);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toEqual({
      path: 'tab\tname.txt',
      binary: false,
      hunks: [
        {
          old: [
            { start: 1, count: 5 },
            { start: 1, count: 5 },
          ],
          new: { start: 1, count: 5 },
          heading: 'export const RETRY = {',
          lines: ['  a', '- B-main', ' -B-feat', '++B-res', '  c', '  d', '  e'],
        },
      ],
    });
  });

  it('reads hunks of octopus merges (one marker column per parent)', () => {
    // "same" is in every parent, the added line already was in the third, "gone" only in the first.
    const text = ['@@@@ -1,2 -1,1 -1,2 +1,2 @@@@', '   same', '++ only in the third', '-  gone', ''].join('\n');
    const [hunk] = parsePatch(text, 3).hunks;
    expect(hunk?.old).toEqual([
      { start: 1, count: 2 },
      { start: 1, count: 1 },
      { start: 1, count: 2 },
    ]);
    expect(hunk?.lines).toEqual(['   same', '++ only in the third', '-  gone']);
  });
});

describe('parsePatch', () => {
  it('reads hunks with their ranges and headings, skipping the file header', () => {
    const text = [
      'diff --git a/src/auth.ts b/src/api/login.ts',
      'similarity index 94%',
      'rename from src/auth.ts',
      'rename to src/api/login.ts',
      'index 1111111..2222222 100644',
      '--- a/src/auth.ts',
      '+++ b/src/api/login.ts',
      '@@ -8 +8 @@ export interface Credentials {',
      '-export const AUTH_VERSION = 1;',
      '+export const AUTH_VERSION = 2;',
      '@@ -20,3 +20,4 @@',
      ' a',
      '+b',
      ' c',
      ' d',
      '',
    ].join('\n');
    expect(parsePatch(text)).toEqual({
      binary: false,
      hunks: [
        {
          old: [{ start: 8, count: 1 }],
          new: { start: 8, count: 1 },
          heading: 'export interface Credentials {',
          lines: ['-export const AUTH_VERSION = 1;', '+export const AUTH_VERSION = 2;'],
        },
        { old: [{ start: 20, count: 3 }], new: { start: 20, count: 4 }, heading: '', lines: [' a', '+b', ' c', ' d'] },
      ],
    });
  });

  it('reads hunk bodies by their counts: header-like lines, empty lines and missing final newlines', () => {
    const text = [
      '@@ -1,3 +1,4 @@',
      ' @@ not a header @@',
      '', // an empty context line whose leading space was dropped
      '-old',
      '\\ No newline at end of file',
      '+diff --git a/x b/x',
      '+new',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const [hunk] = parsePatch(text).hunks;
    expect(hunk?.lines).toEqual([
      ' @@ not a header @@',
      ' ',
      '-old',
      '\\ No newline at end of file',
      '+diff --git a/x b/x',
      '+new',
      '\\ No newline at end of file',
    ]);
  });

  it('joins the deletion and addition of a type change; flags binary patches', () => {
    const typechange = [
      'diff --git a/link b/link',
      'deleted file mode 120000',
      '--- a/link',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-../README.md',
      '\\ No newline at end of file',
      'diff --git a/link b/link',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/link',
      '@@ -0,0 +1 @@',
      '+now a file',
      '',
    ].join('\n');
    expect(parsePatch(typechange).hunks.map((h) => h.lines)).toEqual([
      ['-../README.md', '\\ No newline at end of file'],
      ['+now a file'],
    ]);
    expect(parsePatch('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n')).toEqual({ binary: true, hunks: [] });
    expect(parsePatch('diff --cc x.png\nBinary files differ\n', 2).binary).toBe(true);
  });

  it('refuses a malformed hunk header', () => {
    expect(() => parsePatch('@@ -x +1 @@\n')).toThrow(/unexpected hunk header/);
  });
});

describe('unquotePath', () => {
  it.each([
    ['plain.txt', 'plain.txt'],
    ['"tab\\there.txt"', 'tab\there.txt'],
    ['"new\\nline.txt"', 'new\nline.txt'],
    ['"\\"quoted\\".txt"', '"quoted".txt'],
    ['"back\\\\slash"', 'back\\slash'],
    ['"caf\\303\\251.md"', 'café.md'],
    ['"naïve\\tcafé"', 'naïve\tcafé'],
  ])('%s → %j', (quoted, path) => {
    expect(unquotePath(quoted)).toBe(path);
  });
});
