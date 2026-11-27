import { describe, expect, it } from 'vitest';

import type { DiffHunk, FileDiff } from '../../../shared/api.ts';
import { languageFor } from './language.ts';
import { buildCombinedRows, buildRows, CONTEXT_LINES, EXPAND_STEP, parseDiff, revealMore, type Reveal, type Row } from './rows.ts';
import { wordDiff } from './words.ts';

const fileDiff = (hunks: DiffHunk[], extra: Partial<FileDiff> = {}): FileDiff => ({
  path: 'a.ts',
  status: 'modified',
  fullContext: true,
  columns: 1,
  hunks,
  ...extra,
});

/** A full-context hunk over `count` lines where the lines at `changed` were edited. */
function wholeFile(count: number, changed: number[]): DiffHunk {
  const lines: string[] = [];
  for (let n = 1; n <= count; n++) {
    if (changed.includes(n)) lines.push(`-line ${n}`, `+line ${n} edited`);
    else lines.push(` line ${n}`);
  }
  return { old: [{ start: 1, count }], new: { start: 1, count }, heading: '', lines };
}

/** Rows as short strings: "c12" context line 12 (new numbering), "-12"/"+12" changes, "~N" a fold, "@@" a hunk header. */
const describeRows = (rows: Row[]) =>
  rows.map((row) => {
    if (row.kind === 'fold') return `~${row.hidden}`;
    if (row.kind === 'hunk') return '@@';
    const line = row.kind === 'line' ? row.line : (row.left ?? row.right)!;
    return line.kind === 'context' ? `c${line.newNo}` : line.kind === 'add' ? `+${line.newNo}` : `-${line.oldNo}`;
  });

describe('parseDiff', () => {
  it('numbers lines on both sides and rebuilds the old and new text', () => {
    const parsed = parseDiff(
      fileDiff([
        { old: [{ start: 1, count: 3 }], new: { start: 1, count: 3 }, heading: '', lines: [' a', '-b', '+B', ' c', '\\ No newline at end of file'] },
      ]),
    );
    expect(parsed.hunks[0]?.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['context', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['context', 3, 3],
    ]);
    expect(parsed.hunks[0]?.lines.at(-1)?.noEol).toBe(true);
    expect(parsed.oldText).toBe('a\nb\nc');
    expect(parsed.newText).toBe('a\nB\nc');
    expect([parsed.additions, parsed.deletions]).toEqual([1, 1]);
    expect(parsed.hunks[0]?.header).toBe('@@ -1,3 +1,3 @@');
  });

  it('adds word-level changes to paired lines only when they are similar enough', () => {
    const parsed = parseDiff(
      fileDiff([
        {
          old: [{ start: 1, count: 2 }],
          new: { start: 1, count: 2 },
          heading: '',
          lines: ['-export const AUTH_VERSION = 1;', '-completely different', '+export const AUTH_VERSION = 2;', '+zzz qqq'],
        },
      ]),
    );
    const [del1, del2, add1, add2] = parsed.hunks[0]!.lines;
    expect(del1?.words).toEqual([{ start: 28, end: 29 }]);
    expect(add1?.words).toEqual([{ start: 28, end: 29 }]);
    expect(del2?.words).toBeUndefined();
    expect(add2?.words).toBeUndefined();
  });
});

describe('buildRows', () => {
  const unified = { mode: 'unified' as const, fullContext: true, reveals: new Map<number, Reveal>() };

  it('folds long unchanged runs, keeping three lines around each change', () => {
    const parsed = parseDiff(fileDiff([wholeFile(40, [20])]));
    expect(describeRows(buildRows(parsed, unified))).toEqual(['~16', 'c17', 'c18', 'c19', '-20', '+20', 'c21', 'c22', 'c23', '~17']);
    expect(CONTEXT_LINES).toBe(3);
  });

  it('shows short unchanged runs instead of folding them', () => {
    const parsed = parseDiff(fileDiff([wholeFile(14, [3, 12])]));
    expect(describeRows(buildRows(parsed, unified)).filter((r) => r.startsWith('~'))).toEqual([]);
  });

  it('unfolds step by step from either side, or all at once', () => {
    const parsed = parseDiff(fileDiff([wholeFile(100, [10, 90])]));
    let reveals = new Map<number, Reveal>();
    const middleFold = () => {
      const row = buildRows(parsed, { ...unified, reveals }).find((r) => r.kind === 'fold' && r.down && r.up);
      return row?.kind === 'fold' ? row : undefined;
    };
    const id = middleFold()?.fold ?? -1;
    expect(middleFold()).toMatchObject({ hidden: 73, up: true, down: true });

    reveals = revealMore(reveals, id, 'top');
    expect(middleFold()).toMatchObject({ fold: id, hidden: 73 - EXPAND_STEP });
    reveals = revealMore(reveals, id, 'bottom');
    expect(middleFold()).toMatchObject({ fold: id, hidden: 73 - 2 * EXPAND_STEP });

    reveals.set(id, 'all');
    expect(middleFold()).toBeUndefined();
    // The folds at the top and bottom of the file only open towards the change.
    const edges = buildRows(parsed, unified).filter((r) => r.kind === 'fold' && !(r.up && r.down));
    expect(edges.map((r) => r.kind === 'fold' && [r.up, r.down])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it('pairs removed and added lines side by side in split mode', () => {
    const parsed = parseDiff(
      fileDiff([{ old: [{ start: 1, count: 3 }], new: { start: 1, count: 2 }, heading: '', lines: [' a', '-b', '-c', '+B'] }]),
    );
    const rows = buildRows(parsed, { ...unified, mode: 'split' });
    expect(rows.map((r) => r.kind === 'pair' && [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ['a', 'a'],
      ['b', 'B'],
      ['c', null],
    ]);
  });

  it("puts git's hunk headers between hunks when only some context is loaded", () => {
    const parsed = parseDiff(
      fileDiff(
        [
          { old: [{ start: 1, count: 1 }], new: { start: 1, count: 1 }, heading: '', lines: ['-a', '+A'] },
          { old: [{ start: 50, count: 1 }], new: { start: 50, count: 1 }, heading: 'function f() {', lines: ['-x', '+X'] },
        ],
        { fullContext: false },
      ),
    );
    const rows = buildRows(parsed, { ...unified, fullContext: false });
    expect(describeRows(rows)).toEqual(['@@', '-1', '+1', '@@', '-50', '+50']);
    expect(rows[3]).toMatchObject({ header: '@@ -50 +50 @@ function f() {' });
  });
});

describe('buildCombinedRows', () => {
  it('keeps one marker per parent and numbers the lines of the result', () => {
    const rows = buildCombinedRows(
      fileDiff(
        [
          {
            old: [
              { start: 1, count: 2 },
              { start: 1, count: 2 },
            ],
            new: { start: 1, count: 2 },
            heading: '',
            lines: ['  a', '- B-main', ' -B-feat', '++B-res'],
          },
        ],
        { columns: 2, fullContext: false },
      ),
    );
    expect(rows.map((r) => (r.kind === 'line' ? [r.markers, r.text, r.newNo] : r.header))).toEqual([
      '@@@ -1,2 -1,2 +1,2 @@@',
      ['  ', 'a', 1],
      ['- ', 'B-main', null],
      [' -', 'B-feat', null],
      ['++', 'B-res', 2],
    ]);
  });
});

describe('wordDiff', () => {
  it('marks the changed words and joins changes separated by spaces', () => {
    expect(wordDiff('const a = 1;', 'const a = 2;')).toEqual({ a: [{ start: 10, end: 11 }], b: [{ start: 10, end: 11 }] });
    // The words differ, the structure around them doesn't: one range per side.
    expect(wordDiff('if (user and pass) {', 'if (name or token) {')).toEqual({ a: [{ start: 4, end: 17 }], b: [{ start: 4, end: 17 }] });
    expect(wordDiff('completely different', 'zzz qqq')).toBeNull(); // too little in common to help
    expect(wordDiff('return greet(name)', 'return greet(name, end)')?.b).toEqual([{ start: 17, end: 22 }]);
  });

  it('handles identical lines, unicode and giant lines', () => {
    expect(wordDiff('same', 'same')).toEqual({ a: [], b: [] });
    expect(wordDiff('const 名前 = "ファイル";', 'const 名前 = "ファイルX";')?.b).toEqual([{ start: 12, end: 17 }]);
    const long = Array.from({ length: 2000 }, (_, i) => `w${i}`).join(' ');
    expect(wordDiff(long, `${long} x`)).toBeNull();
  });
});

describe('languageFor', () => {
  const ids = ['typescript', 'tsx', 'javascript', 'json', 'docker', 'make', 'dotenv', 'csv', 'cpp', 'yaml', 'markdown'];
  const aliases: Record<string, string> = { ts: 'typescript', js: 'javascript', md: 'markdown', yml: 'yaml' };
  const known = (id: string) => (ids.includes(id) ? id : (aliases[id] ?? null));

  it.each([
    ['src/api/login.ts', 'typescript'],
    ['src/types.d.ts', 'typescript'],
    ['App.TSX', 'tsx'],
    ['vite.config.mjs', 'javascript'],
    ['package.json', 'json'],
    ['Dockerfile', 'docker'],
    ['build/Dockerfile.prod', 'docker'],
    ['Makefile', 'make'],
    ['.env.local', 'dotenv'],
    ['data/big.csv', 'csv'],
    ['lib/x.hpp', 'cpp'],
    ['README.md', 'markdown'],
  ])('%s → %s', (path, language) => {
    expect(languageFor(path, known)).toBe(language);
  });

  it.each(['notes.txt', 'LICENSE', 'odd/new\nline.txt', 'image.png', 'archive.unknownext'])('%j is plain text', (path) => {
    expect(languageFor(path, known)).toBeNull();
  });
});

describe('spansFor', () => {
  it('cuts a line at token and word-change boundaries, merging equal neighbours', async () => {
    const { spansFor } = await import('./highlight.ts');
    // "const x = 1;" as tokens: "const"(style 0) " "(1) "x"(2) " = "(1) "1"(3) ";"(1)
    const tokens = [5, 0, 1, 1, 1, 2, 3, 1, 1, 3, 1, 1];
    expect(spansFor('const x = 1;', tokens, [{ start: 10, end: 11 }])).toEqual([
      { text: 'const', style: 0, changed: false },
      { text: ' ', style: 1, changed: false },
      { text: 'x', style: 2, changed: false },
      { text: ' = ', style: 1, changed: false },
      { text: '1', style: 3, changed: true },
      { text: ';', style: 1, changed: false },
    ]);
    expect(spansFor('plain text', undefined, [{ start: 6, end: 10 }])).toEqual([
      { text: 'plain ', style: -1, changed: false },
      { text: 'text', style: -1, changed: true },
    ]);
    expect(spansFor('', undefined)).toEqual([]);
  });
});
