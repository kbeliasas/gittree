import type { FileDiff } from '../../../shared/api.ts';
import { wordDiff, type Range } from './words.ts';

export type LineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: LineKind;
  text: string;
  /** 1-based; null on the side the line isn't on. */
  oldNo: number | null;
  newNo: number | null;
  /** The file has no newline after this line. */
  noEol?: true;
  /** Position in `oldText` / `newText`, which are highlighted as wholes. */
  oldIndex: number | null;
  newIndex: number | null;
  /** Word-level changes against the line it replaces (or is replaced by). */
  words?: Range[];
}

export interface ParsedHunk {
  /** "@@ -1,5 +1,6 @@ heading" */
  header: string;
  lines: DiffLine[];
}

export interface ParsedDiff {
  hunks: ParsedHunk[];
  /** The old and new file as far as the hunks show it: all of it with full context. */
  oldText: string;
  newText: string;
  additions: number;
  deletions: number;
}

/** Ordinary (one marker column) diffs only; combined diffs use buildCombinedRows. */
export function parseDiff(diff: FileDiff): ParsedDiff {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let additions = 0;
  let deletions = 0;

  const hunks = diff.hunks.map((hunk): ParsedHunk => {
    let oldNo = hunk.old[0]!.start;
    let newNo = hunk.new.start;
    const lines: DiffLine[] = [];
    for (const raw of hunk.lines) {
      const marker = raw[0];
      if (marker === '\\') {
        const last = lines.at(-1);
        if (last) last.noEol = true;
        continue;
      }
      const text = raw.slice(1);
      if (marker === '+') {
        lines.push({ kind: 'add', text, oldNo: null, newNo: newNo++, oldIndex: null, newIndex: newLines.push(text) - 1 });
        additions++;
      } else if (marker === '-') {
        lines.push({ kind: 'del', text, oldNo: oldNo++, newNo: null, oldIndex: oldLines.push(text) - 1, newIndex: null });
        deletions++;
      } else {
        lines.push({
          kind: 'context',
          text,
          oldNo: oldNo++,
          newNo: newNo++,
          oldIndex: oldLines.push(text) - 1,
          newIndex: newLines.push(text) - 1,
        });
      }
    }
    addWordDiffs(lines);
    const range = (start: number, count: number) => (count === 1 ? `${start}` : `${start},${count}`);
    const header = `@@ -${range(hunk.old[0]!.start, hunk.old[0]!.count)} +${range(hunk.new.start, hunk.new.count)} @@${hunk.heading ? ` ${hunk.heading}` : ''}`;
    return { header, lines };
  });

  return { hunks, oldText: oldLines.join('\n'), newText: newLines.join('\n'), additions, deletions };
}

/** Within each change block, the n-th removed line pairs with the n-th added line. */
function addWordDiffs(lines: DiffLine[]): void {
  forEachBlock(lines, (dels, adds) => {
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const words = wordDiff(dels[k]!.text, adds[k]!.text);
      if (words) {
        dels[k]!.words = words.a;
        adds[k]!.words = words.b;
      }
    }
  });
}

/** Calls `fn` with the removed and added lines of every run of changes. */
function forEachBlock(lines: readonly DiffLine[], fn: (dels: DiffLine[], adds: DiffLine[]) => void): void {
  for (let i = 0; i < lines.length; ) {
    if (lines[i]!.kind === 'context') {
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    for (; i < lines.length && lines[i]!.kind !== 'context'; i++) (lines[i]!.kind === 'del' ? dels : adds).push(lines[i]!);
    fn(dels, adds);
  }
}

/** Unchanged lines shown around each change. */
export const CONTEXT_LINES = 3;
/** Shorter runs of unchanged lines are shown rather than folded. */
const MIN_FOLD = 6;
/** Lines one click on a fold's arrow reveals. */
export const EXPAND_STEP = 20;

/** How much of a fold is revealed: lines from its top and its bottom, or all of it. */
export type Reveal = { top: number; bottom: number } | 'all';

export type Row =
  /** Start of a hunk when only some context is loaded: git's own header. */
  | { kind: 'hunk'; key: string; header: string }
  /**
   * Hidden unchanged lines. `fold` identifies it across expansions; `down` reveals
   * lines below the block above it, `up` lines above the block below it.
   */
  | { kind: 'fold'; key: string; fold: number; hidden: number; up: boolean; down: boolean }
  | { kind: 'line'; key: string; line: DiffLine }
  | { kind: 'pair'; key: string; left: DiffLine | null; right: DiffLine | null };

export interface RowOptions {
  mode: 'unified' | 'split';
  /** The hunks hold the whole file, so long unchanged runs fold and can be unfolded. */
  fullContext: boolean;
  reveals: ReadonlyMap<number, Reveal>;
}

export function buildRows(parsed: ParsedDiff, options: RowOptions): Row[] {
  const rows: Row[] = [];
  parsed.hunks.forEach((hunk, h) => {
    if (!options.fullContext) rows.push({ kind: 'hunk', key: `h${h}`, header: hunk.header });
    const visible = options.fullContext ? visibleLines(hunk.lines, options.reveals, h) : null;
    let pending: DiffLine[] = [];
    const flush = () => {
      emitLines(rows, pending, options.mode);
      pending = [];
    };
    for (let i = 0; i < hunk.lines.length; ) {
      const fold = visible?.folds.get(i);
      if (fold) {
        flush();
        rows.push({ kind: 'fold', key: `f${h}:${i}`, fold: foldId(h, fold.start), hidden: fold.end - i, up: fold.up, down: fold.down });
        i = fold.end;
        continue;
      }
      pending.push(hunk.lines[i]!);
      i++;
    }
    flush();
  });
  return rows;
}

/** Folds are identified by hunk and the first line of their run of unchanged lines. */
function foldId(hunk: number, start: number): number {
  return hunk * 1_000_000_000 + start;
}

interface Fold {
  /** First line of the whole unchanged run (stable across reveals). */
  start: number;
  /** First line after the hidden part. */
  end: number;
  up: boolean;
  down: boolean;
}

/** The hidden parts of a full-context hunk, keyed by the first hidden line. */
function visibleLines(lines: readonly DiffLine[], reveals: ReadonlyMap<number, Reveal>, hunk: number): { folds: Map<number, Fold> } {
  const folds = new Map<number, Fold>();
  const changed = lines.map((line) => line.kind !== 'context');
  if (!changed.includes(true)) return { folds }; // nothing to fold around: the view says so instead

  for (let i = 0; i < lines.length; ) {
    if (changed[i]) {
      i++;
      continue;
    }
    const runStart = i;
    while (i < lines.length && !changed[i]) i++;
    const runEnd = i;
    const atTop = runStart === 0;
    const atBottom = runEnd === lines.length;
    // Keep context next to changes: below the change above, above the change below.
    const from = atTop ? runStart : runStart + CONTEXT_LINES;
    const to = atBottom ? runEnd : runEnd - CONTEXT_LINES;
    const reveal = reveals.get(foldId(hunk, runStart));
    if (reveal === 'all' || to - from < MIN_FOLD) continue;
    const hideFrom = from + (reveal?.top ?? 0);
    const hideTo = to - (reveal?.bottom ?? 0);
    if (hideTo - hideFrom < MIN_FOLD / 2) continue; // what's left isn't worth a fold
    folds.set(hideFrom, { start: runStart, end: hideTo, up: !atBottom, down: !atTop });
  }
  return { folds };
}

function emitLines(rows: Row[], lines: readonly DiffLine[], mode: RowOptions['mode']): void {
  if (mode === 'unified') {
    for (const line of lines) rows.push({ kind: 'line', key: lineKey(line), line });
    return;
  }
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (line.kind === 'context') {
      rows.push({ kind: 'pair', key: lineKey(line), left: line, right: line });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    for (; i < lines.length && lines[i]!.kind !== 'context'; i++) (lines[i]!.kind === 'del' ? dels : adds).push(lines[i]!);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      const left = dels[k] ?? null;
      const right = adds[k] ?? null;
      rows.push({ kind: 'pair', key: lineKey((left ?? right)!), left, right });
    }
  }
}

function lineKey(line: DiffLine): string {
  return `${line.kind[0]}${line.oldNo ?? ''}:${line.newNo ?? ''}`;
}

/** Reveals `count` more lines of a fold from one side. */
export function revealMore(reveals: ReadonlyMap<number, Reveal>, fold: number, side: 'top' | 'bottom', count = EXPAND_STEP): Map<number, Reveal> {
  const next = new Map(reveals);
  const current = reveals.get(fold);
  if (current === 'all') return next;
  const base = current ?? { top: 0, bottom: 0 };
  next.set(fold, { ...base, [side]: base[side] + count });
  return next;
}

// ---------------------------------------------------------------------------
// Combined diffs (conflict resolutions): one marker column per parent.

export type CombinedRow =
  | { kind: 'hunk'; key: string; header: string }
  | { kind: 'line'; key: string; markers: string; text: string; newNo: number | null; noEol?: true };

export function buildCombinedRows(diff: FileDiff): CombinedRow[] {
  const columns = diff.columns;
  const rows: CombinedRow[] = [];
  diff.hunks.forEach((hunk, h) => {
    const ranges = [...hunk.old.map((r) => `-${r.start},${r.count}`), `+${hunk.new.start},${hunk.new.count}`].join(' ');
    const at = '@'.repeat(columns + 1);
    rows.push({ kind: 'hunk', key: `h${h}`, header: `${at} ${ranges} ${at}${hunk.heading ? ` ${hunk.heading}` : ''}` });
    let newNo = hunk.new.start;
    hunk.lines.forEach((raw, i) => {
      if (raw.startsWith('\\')) {
        const last = rows.at(-1);
        if (last?.kind === 'line') last.noEol = true;
        return;
      }
      const markers = raw.slice(0, columns);
      const inResult = !markers.includes('-');
      rows.push({ kind: 'line', key: `h${h}:${i}`, markers, text: raw.slice(columns), newNo: inResult ? newNo++ : null });
    });
  });
  return rows;
}
