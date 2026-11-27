import type { DiffHunk, FileStatus } from '../../shared/api.ts';

/** One entry of `git diff-tree -r -z --raw --numstat` output. */
export interface RawChange {
  status: FileStatus;
  /** Renames and copies: similarity in percent. */
  similarity?: number;
  path: string;
  oldPath?: string;
  oldMode: string;
  newMode: string;
  /** Blob (or, for submodules, commit) ids; all zeros where the file is absent. */
  oldObject: string;
  newObject: string;
  /** From the numstat part; null: binary. Without one, 0 (commit.ts sets null when it didn't count). */
  additions: number | null;
  deletions: number | null;
}

/** A combined-diff entry (`git diff-tree --cc --raw`): one mode, object and status per parent. */
export interface CombinedRawChange {
  path: string;
  parentModes: string[];
  newMode: string;
  parentObjects: string[];
  newObject: string;
  /** One status letter per parent. */
  statuses: string;
}

const STATUS: Readonly<Record<string, FileStatus>> = {
  A: 'added',
  C: 'copied',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  T: 'typechange',
  U: 'unmerged',
  X: 'unknown',
};

const NUMSTAT = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/;

/**
 * Parses `git diff-tree -r -z --raw --numstat` output: every raw record
 * (`:<modes> <objects> <status>` then one path, or two for renames and copies),
 * then one numstat record per change in the same order. With -z, paths are
 * verbatim, so tabs, newlines and quotes in file names need no unquoting.
 */
export function parseRawNumstat(output: string): RawChange[] {
  const tokens = output.split('\0');
  const changes: RawChange[] = [];
  let i = 0;

  while (i < tokens.length && tokens[i]!.startsWith(':')) {
    const fields = tokens[i++]!.slice(1).split(' ');
    const [oldMode, newMode, oldObject, newObject, code] = fields;
    if (fields.length !== 5 || !oldMode || !newMode || !oldObject || !newObject || !code) {
      throw new Error(`unexpected raw diff record: ${JSON.stringify(tokens[i - 1])}`);
    }
    const letter = code[0]!;
    const status = STATUS[letter] ?? 'unknown';
    const twoPaths = letter === 'R' || letter === 'C';
    const oldPath = twoPaths ? tokens[i++] : undefined;
    const path = tokens[i++];
    if (path === undefined || path === '' || oldPath === '') throw new Error('raw diff record without a path');
    const change: RawChange = { status, path, oldMode, newMode, oldObject, newObject, additions: 0, deletions: 0 };
    if (oldPath !== undefined) change.oldPath = oldPath;
    if (twoPaths && code.length > 1) change.similarity = Number.parseInt(code.slice(1), 10);
    changes.push(change);
  }

  let n = 0;
  while (i < tokens.length && tokens[i] !== '') {
    const match = NUMSTAT.exec(tokens[i++]!);
    if (!match) throw new Error(`unexpected numstat record: ${JSON.stringify(tokens[i - 1])}`);
    let path = match[3]!;
    if (path === '') {
      i++; // the old path of a rename or copy
      path = tokens[i++] ?? '';
    }
    const change = changes[n++];
    if (!change || change.path !== path) throw new Error(`numstat record for ${JSON.stringify(path)} has no raw record`);
    change.additions = match[1] === '-' ? null : Number.parseInt(match[1]!, 10);
    change.deletions = match[2] === '-' ? null : Number.parseInt(match[2]!, 10);
  }
  if (n !== 0 && n !== changes.length) throw new Error(`numstat covers ${n} of ${changes.length} changes`);
  return changes;
}

/**
 * Parses the raw part of `git diff-tree -r -z --cc --raw` (records start with
 * one colon per parent). Returns the records and whatever follows them: the
 * patch text when `-p` was given too.
 */
export function parseCombinedRaw(output: string): { changes: CombinedRawChange[]; rest: string } {
  const changes: CombinedRawChange[] = [];
  let offset = 0;
  while (output.startsWith('::', offset)) {
    const headerEnd = output.indexOf('\0', offset);
    const pathEnd = headerEnd === -1 ? -1 : output.indexOf('\0', headerEnd + 1);
    if (pathEnd === -1) throw new Error('truncated combined raw diff record');
    const header = output.slice(offset, headerEnd);
    const colons = /^:+/.exec(header)![0].length;
    const fields = header.slice(colons).split(' ');
    const parents = colons;
    if (fields.length !== 2 * (parents + 1) + 1) throw new Error(`unexpected combined diff record: ${JSON.stringify(header)}`);
    const modes = fields.slice(0, parents + 1);
    const objects = fields.slice(parents + 1, 2 * (parents + 1));
    changes.push({
      path: output.slice(headerEnd + 1, pathEnd),
      parentModes: modes.slice(0, parents),
      newMode: modes[parents]!,
      parentObjects: objects.slice(0, parents),
      newObject: objects[parents]!,
      statuses: fields.at(-1)!,
    });
    offset = pathEnd + 1;
  }
  // -z ends the raw part with an extra NUL before any patch text.
  if (output[offset] === '\0') offset++;
  return { changes, rest: output.slice(offset) };
}

export interface ParsedPatch {
  binary: boolean;
  hunks: DiffHunk[];
}

/**
 * Hunks from a patch for one file (`git diff-tree -p`); a type change arrives as
 * a deletion and an addition, whose hunks are simply concatenated. `columns` is
 * 1, or the parent count of a combined diff. Hunk bodies are read by their line
 * counts, so a line that happens to look like a header can't end a hunk early.
 */
export function parsePatch(text: string, columns = 1): ParsedPatch {
  const lines = text.split('\n');
  const hunks: DiffHunk[] = [];
  let binary = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('@'.repeat(columns + 1) + ' ')) {
      const hunk = parseHunkHeader(line, columns);
      i = readHunkBody(lines, i + 1, hunk, columns);
      hunks.push(hunk);
      continue;
    }
    // "Binary files a/x and b/x differ"; combined diffs just say "Binary files differ".
    if (/^Binary files (?:.* )?differ$/.test(line) || line === 'GIT binary patch') binary = true;
    i++;
  }
  return { binary, hunks };
}

/** One file's part of a combined patch (`diff --cc <path>`). */
export interface CombinedSection extends ParsedPatch {
  path: string;
}

/** Splits `git diff-tree --cc -p` output into per-file sections. Paths are unquoted. */
export function splitCombinedPatch(text: string, columns: number): CombinedSection[] {
  const sections: CombinedSection[] = [];
  const starts: Array<{ index: number; path: string }> = [];
  const header = /^diff --(?:cc|combined) (.*)$/gm;
  for (let match = header.exec(text); match; match = header.exec(text)) {
    starts.push({ index: match.index, path: unquotePath(match[1]!) });
  }
  starts.forEach((start, k) => {
    const end = starts[k + 1]?.index ?? text.length;
    const body = text.slice(text.indexOf('\n', start.index) + 1, end);
    sections.push({ path: start.path, ...parsePatch(body, columns) });
  });
  return sections;
}

const ESCAPES: Readonly<Record<string, number>> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/**
 * Undoes git's C-style quoting of a path ("tab\there.txt", "caf\303\251"):
 * octal escapes are raw bytes, so the result is decoded as UTF-8.
 */
export function unquotePath(text: string): string {
  if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) return text;
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const body = text.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (char !== '\\') {
      const code = body.codePointAt(i)!;
      const piece = String.fromCodePoint(code);
      bytes.push(...encoder.encode(piece));
      i += piece.length - 1;
      continue;
    }
    const next = body[++i] ?? '';
    if (/[0-7]/.test(next)) {
      const octal = body.slice(i, i + 3);
      bytes.push(Number.parseInt(octal, 8) & 0xff);
      i += octal.length - 1;
    } else {
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function parseHunkHeader(line: string, columns: number): DiffHunk {
  const at = '@'.repeat(columns + 1);
  const range = '(\\d+)(?:,(\\d+))?';
  const pattern = new RegExp(`^${at}${` -${range}`.repeat(columns)} \\+${range} ${at}(?: (.*))?$`);
  const match = pattern.exec(line);
  if (!match) throw new Error(`unexpected hunk header: ${JSON.stringify(line)}`);
  const number = (k: number, fallback: number) => (match[k] === undefined ? fallback : Number.parseInt(match[k]!, 10));
  const old = Array.from({ length: columns }, (_, p) => ({ start: number(1 + 2 * p, 0), count: number(2 + 2 * p, 1) }));
  return {
    old,
    new: { start: number(1 + 2 * columns, 0), count: number(2 + 2 * columns, 1) },
    heading: match[3 + 2 * columns] ?? '',
    lines: [],
  };
}

function readHunkBody(lines: readonly string[], start: number, hunk: DiffHunk, columns: number): number {
  const oldLeft = hunk.old.map((range) => range.count);
  let newLeft = hunk.new.count;
  let i = start;
  const remaining = () => newLeft > 0 || oldLeft.some((n) => n > 0);

  while (i < lines.length && remaining()) {
    let line = lines[i]!;
    // An empty line is an empty context line (git can drop its leading space).
    if (line.length < columns) line = ' '.repeat(columns) + line;
    const markers = line.slice(0, columns);
    if (line.startsWith('\\')) {
      hunk.lines.push(line);
      i++;
      continue;
    }
    if (!/^[ +-]+$/.test(markers)) break; // malformed: stop rather than swallow the next header
    const inNew = !markers.includes('-');
    for (let p = 0; p < columns; p++) {
      const inParent = markers[p] === '-' || (inNew && markers[p] === ' ');
      if (inParent) oldLeft[p]!--;
    }
    if (inNew) newLeft--;
    hunk.lines.push(line);
    i++;
  }
  // "\ No newline at end of file" after the last line.
  while (i < lines.length && lines[i]!.startsWith('\\')) hunk.lines.push(lines[i++]!);
  return i;
}
