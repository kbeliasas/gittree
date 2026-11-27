import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ChangedFile, CommitDetails, CompareWith, FileDiff, FileStatus, Signature } from '../../shared/api.ts';
import { HttpError } from '../errors.ts';
import {
  parseCombinedRaw,
  parsePatch,
  parseRawNumstat,
  splitCombinedPatch,
  type CombinedRawChange,
  type ParsedPatch,
  type RawChange,
} from '../git/diff.ts';
import { GitError } from '../git/errors.ts';
import type { GitRunner } from '../git/runner.ts';
import type { Repo } from '../repos/repo.ts';

/**
 * Diffs of files up to this size carry the whole file as context, so the viewer
 * can unfold unchanged lines and highlight with full-file context. Larger files
 * get the usual three lines of context.
 */
export const FULL_CONTEXT_MAX_BYTES = 1024 * 1024;

/** Nine NUL-separated fields; the message comes last because it is the only one that may contain anything. */
export const COMMIT_FORMAT = '--format=%H%x00%P%x00%aN%x00%aE%x00%ad%x00%cN%x00%cE%x00%cd%x00%B';
const META_FIELDS = 8;

/** Diff options that keep output independent of the user's diff drivers and colors. */
const PLAIN_DIFF = ['--no-commit-id', '--no-ext-diff', '--no-textconv', '--no-color'];

export interface CommitMeta {
  sha: string;
  parents: string[];
  author: Signature;
  committer: Signature;
  message: string;
}

export function parseCommitMeta(output: string): CommitMeta | null {
  const fields: string[] = [];
  let offset = 0;
  for (let k = 0; k < META_FIELDS; k++) {
    const end = output.indexOf('\0', offset);
    if (end === -1) return null;
    fields.push(output.slice(offset, end));
    offset = end + 1;
  }
  const [sha = '', parents = '', authorName = '', authorEmail = '', authorDate = '', committerName = '', committerEmail = '', committerDate = ''] =
    fields;
  return {
    sha,
    parents: parents === '' ? [] : parents.split(' '),
    author: signature(authorName, authorEmail, authorDate),
    committer: signature(committerName, committerEmail, committerDate),
    message: output.slice(offset).replace(/\n+$/, ''),
  };
}

/** `--date=raw`: "1736154000 +0200". */
function signature(name: string, email: string, date: string): Signature {
  const match = /^(-?\d+) ([+-])(\d\d)(\d\d)$/.exec(date.trim());
  if (!match) return { name, email, time: 0, tz: 0 };
  const sign = match[2] === '-' ? -1 : 1;
  return { name, email, time: Number(match[1]), tz: sign * (Number(match[3]) * 60 + Number(match[4])) };
}

export async function readCommitMeta(git: GitRunner, repo: Repo, sha: string, signal?: AbortSignal): Promise<CommitMeta> {
  let output: string;
  try {
    output = await git.text('log', { cwd: repo.path, signal, args: ['-1', '--date=raw', COMMIT_FORMAT], revs: [sha], paths: [] });
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 128 && /bad object|unknown revision|bad revision/i.test(error.stderr)) {
      throw commitNotFound(sha);
    }
    throw error;
  }
  const meta = parseCommitMeta(output);
  // A tree or blob id prints nothing; a tag id prints the commit it points at.
  if (!meta || meta.sha !== sha) throw commitNotFound(sha);
  return meta;
}

function commitNotFound(sha: string): HttpError {
  return new HttpError(404, 'commit_not_found', `No commit ${sha} in this repository.`);
}

/**
 * The commit's metadata plus its changed files compared with `compare`.
 * `loadCombined` lets the caller share (cache) the conflict-resolution diff with readFileDiff.
 */
export async function readCommitDetails(
  git: GitRunner,
  repo: Repo,
  sha: string,
  compare: CompareWith,
  signal?: AbortSignal,
  loadCombined: (meta: CommitMeta) => Promise<Combined> = (meta) => readCombined(git, repo, meta, false, signal),
): Promise<CommitDetails> {
  const meta = await readCommitMeta(git, repo, sha, signal);
  const boundary = meta.parents.length === 0 && (await isShallowBoundary(git, repo, sha, signal));
  const base = { ...meta, ...(boundary ? { boundary: true as const } : {}) };
  if (boundary) return { ...base, compare: null };

  if (compare === 'cc') {
    const combined = await loadCombined(meta);
    return { ...base, compare: { with: 'cc', files: combined.files } };
  }
  const parent = parentFor(meta, compare);
  const changes = await readChanges(git, repo, parent, sha, signal);
  const sizes = await readSizes(git, repo, changes.flatMap((c) => [sizeable(c.oldMode, c.oldObject), sizeable(c.newMode, c.newObject)]), signal);
  return { ...base, compare: { with: parent === null ? 'root' : compare, files: changes.map((change) => toChangedFile(change, sizes)) } };
}

/** The parent to compare with, or null for a root commit (compared with the empty tree). */
function parentFor(meta: CommitMeta, n: number): string | null {
  if (meta.parents.length === 0 && n === 1) return null;
  const parent = meta.parents[n - 1];
  if (parent === undefined) {
    const has = meta.parents.length === 1 ? 'one parent' : `${meta.parents.length} parents`;
    throw new HttpError(400, 'no_such_parent', `Commit ${meta.sha} has ${has}; there is no parent ${n}.`);
  }
  return parent;
}

async function readChanges(git: GitRunner, repo: Repo, parent: string | null, sha: string, signal?: AbortSignal): Promise<RawChange[]> {
  const output = await git.text('diff-tree', {
    cwd: repo.path,
    signal,
    args: ['-r', '-z', '-M', '--raw', '--numstat', ...PLAIN_DIFF, ...(parent === null ? ['--root'] : [])],
    revs: parent === null ? [sha] : [parent, sha],
    paths: [],
  });
  return parseRawNumstat(output);
}

function toChangedFile(change: RawChange, sizes: ReadonlyMap<string, number>): ChangedFile {
  const file: ChangedFile = {
    path: change.path,
    status: change.status,
    additions: change.additions,
    deletions: change.deletions,
    oldMode: change.oldMode,
    newMode: change.newMode,
  };
  if (change.oldPath !== undefined) file.oldPath = change.oldPath;
  if (change.similarity !== undefined) file.similarity = change.similarity;
  if (change.additions === null) file.binary = true;
  const oldSize = sizes.get(change.oldObject);
  const newSize = sizes.get(change.newObject);
  if (oldSize !== undefined && sizeable(change.oldMode, change.oldObject)) file.oldSize = oldSize;
  if (newSize !== undefined && sizeable(change.newMode, change.newObject)) file.newSize = newSize;
  return file;
}

const SUBMODULE_MODE = '160000';

/** Objects whose size means something: present blobs, not submodule commits. */
function sizeable(mode: string, object: string): string | undefined {
  return mode === SUBMODULE_MODE || /^0+$/.test(object) ? undefined : object;
}

/** Sizes of blobs by id, from one `git cat-file --batch-check`. */
async function readSizes(
  git: GitRunner,
  repo: Repo,
  objects: ReadonlyArray<string | undefined>,
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const unique = [...new Set(objects.filter((o): o is string => o !== undefined))];
  const sizes = new Map<string, number>();
  if (unique.length === 0) return sizes;
  const output = await git.text('cat-file', { cwd: repo.path, signal, args: ['--batch-check'], input: `${unique.join('\n')}\n` });
  for (const line of output.split('\n')) {
    const [object, type, size] = line.split(' ');
    if (object && type === 'blob' && size !== undefined) sizes.set(object, Number.parseInt(size, 10));
  }
  return sizes;
}

export interface Combined {
  files: ChangedFile[];
  /** Hunks per path; `columns` is the parent count. */
  patches: Map<string, ParsedPatch>;
  columns: number;
}

/**
 * A merge's conflict resolutions: `git diff-tree --cc` keeps only hunks that
 * differ from every parent, so cleanly merged files drop out (their raw record
 * stays, but they get no patch section; they are left out of the list).
 */
export async function readCombined(
  git: GitRunner,
  repo: Repo,
  meta: Pick<CommitMeta, 'sha' | 'parents'>,
  ignoreWhitespace: boolean,
  signal?: AbortSignal,
): Promise<Combined> {
  if (meta.parents.length < 2) {
    throw new HttpError(400, 'not_a_merge', `Commit ${meta.sha} isn't a merge, so it has no conflict resolutions.`);
  }
  const output = await git.text('diff-tree', {
    cwd: repo.path,
    signal,
    args: ['-r', '-z', '--cc', '--raw', '-p', ...PLAIN_DIFF, ...(ignoreWhitespace ? ['-w'] : [])],
    revs: [meta.sha],
    paths: [],
  });
  const columns = meta.parents.length;
  const { changes, rest } = parseCombinedRaw(output);
  const raw = new Map(changes.map((change) => [change.path, change]));
  const patches = new Map<string, ParsedPatch>();
  for (const section of splitCombinedPatch(rest, columns)) {
    if (section.hunks.length > 0 || section.binary) patches.set(section.path, section);
  }
  const listed = changes.filter((change) => patches.has(change.path));
  const sizes = await readSizes(git, repo, listed.map((c) => sizeable(c.newMode, c.newObject)), signal);
  const files = listed.map((change) => combinedFile(change, patches.get(change.path)!, sizes));
  return { files, patches, columns };
}

function combinedFile(change: CombinedRawChange, patch: ParsedPatch, sizes: ReadonlyMap<string, number>): ChangedFile {
  const letters = [...change.statuses];
  const status: FileStatus = letters.every((l) => l === 'A') ? 'added' : letters.every((l) => l === 'D') ? 'deleted' : 'modified';
  const file: ChangedFile = {
    path: change.path,
    status,
    additions: null,
    deletions: null,
    oldMode: change.parentModes[0] ?? '000000',
    newMode: change.newMode,
  };
  if (patch.binary) file.binary = true;
  const newSize = sizes.get(change.newObject);
  if (newSize !== undefined) file.newSize = newSize;
  return file;
}

export interface FileDiffRequest {
  /** Must be what `details` was read with. */
  compare: CompareWith;
  /** One of `details`' changed files. */
  path: string;
  ignoreWhitespace: boolean;
  /** The conflict-resolution diff for `compare: 'cc'`, with the same whitespace setting. */
  combined: () => Promise<Combined>;
  signal?: AbortSignal;
  /** Default FULL_CONTEXT_MAX_BYTES. */
  fullContextMaxBytes?: number;
}

/** One file's diff; `details` comes from readCommitDetails with the same `compare`. */
export async function readFileDiff(git: GitRunner, repo: Repo, details: CommitDetails, request: FileDiffRequest): Promise<FileDiff> {
  const { compare, path, ignoreWhitespace, combined, signal } = request;
  const maxBytes = request.fullContextMaxBytes ?? FULL_CONTEXT_MAX_BYTES;
  const file = details.compare?.files.find((f) => f.path === path);
  if (!details.compare || !file) {
    throw new HttpError(404, 'file_not_changed', `${path} isn't among the files this commit changes.`);
  }
  const base = { path: file.path, ...(file.oldPath !== undefined ? { oldPath: file.oldPath } : {}), status: file.status };

  if (compare === 'cc') {
    const { patches, columns } = await combined();
    const patch = patches.get(path);
    // With whitespace ignored a resolution can vanish entirely.
    return { ...base, ...(patch?.binary ? { binary: true as const } : {}), fullContext: false, columns, hunks: patch?.hunks ?? [] };
  }
  if (file.binary) return { ...base, binary: true, fullContext: false, columns: 1, hunks: [] };

  const fullContext = (file.oldSize ?? 0) <= maxBytes && (file.newSize ?? 0) <= maxBytes;
  // A file of n bytes has at most n + 1 lines, so this much context always yields a single hunk.
  const context = fullContext ? Math.max(file.oldSize ?? 0, file.newSize ?? 0) + 1 : 3;
  const parent = details.compare.with === 'root' ? null : details.parents[(details.compare.with as number) - 1]!;
  const output = await git.text('diff-tree', {
    cwd: repo.path,
    signal,
    args: [
      '-p',
      ...PLAIN_DIFF,
      `-U${context}`,
      ...(ignoreWhitespace ? ['-w'] : []),
      ...(file.oldPath !== undefined ? ['-M'] : []),
      ...(parent === null ? ['--root'] : []),
    ],
    revs: parent === null ? [details.sha] : [parent, details.sha],
    paths: file.oldPath !== undefined ? [file.oldPath, file.path] : [file.path],
  });
  const patch = parsePatch(output);
  return { ...base, ...(patch.binary ? { binary: true as const } : {}), fullContext, columns: 1, hunks: patch.hunks };
}

/** Shallow-file locations by repository; the path never changes, the contents may. */
const shallowFiles = new Map<string, string>();

async function isShallowBoundary(git: GitRunner, repo: Repo, sha: string, signal?: AbortSignal): Promise<boolean> {
  let file = shallowFiles.get(repo.path);
  if (file === undefined) {
    // In the common git dir; --git-path also finds it from a linked worktree.
    const output = await git.text('rev-parse', { cwd: repo.path, signal, args: ['--git-path', 'shallow'] });
    file = resolve(repo.path, output.trim());
    shallowFiles.set(repo.path, file);
  }
  try {
    return (await readFile(file, 'utf8')).split('\n').includes(sha);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
