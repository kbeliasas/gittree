import type { GraphOrder, SearchEvent, SearchKind } from '../../shared/api.ts';
import { HttpError } from '../errors.ts';
import { GitError } from '../git/errors.ts';
import { isMissingObjectError } from '../git/partial.ts';
import type { GitRunner } from '../git/runner.ts';
import type { RefsSnapshot } from '../graph/graph.ts';
import type { Repo } from '../repos/repo.ts';

/**
 * PLAN §8 server search: the commits whose own changes match a term.
 *  - `path:` — commits that changed a matching file. A merge counts when its combined diff
 *    touches the path, i.e. the file differs from every parent (a conflict resolution or an edit
 *    the merge itself made), not when it merely brought a branch's change in.
 *  - `content:` — commits that change how often a text occurs (`git log -S`); merges aren't searched.
 *  - `regex:` — commits with an added or removed line matching a POSIX extended regular
 *    expression (`git log -G`); merges aren't searched.
 *
 * The search covers the graph page's commits (same snapshot, order and limit), fed to
 * `git diff-tree --stdin` in batches: several run at once, every finished batch is reported as
 * progress, and aborting the signal kills the git processes still running.
 */
export interface SearchTerm {
  kind: SearchKind;
  value: string;
  /** regex: only. */
  ignoreCase: boolean;
}

export interface SearchScope {
  order: GraphOrder;
  limit: number;
}

/** Batch sizes and parallelism; tests make them small. */
export interface SearchTuning {
  firstBatch: number;
  batch: number;
  parallel: number;
}

export interface SearchRun {
  /** Commits the search covers. */
  total: number;
  /** Progress events (the first batch's included), then `done`; or `error` when a later batch fails. */
  events: AsyncGenerator<SearchEvent>;
}

/** Characters that make a `path:` value a git glob (`*` within a folder, `**` across folders); otherwise it is a literal path. */
const GLOB = /[*?[]/;
/** Commits per git process. The first batch is small, so its errors arrive before anything streams. */
const FIRST_BATCH = 50;
const BATCH: Readonly<Record<SearchKind, number>> = { path: 2_000, content: 250, regex: 250 };
/** git processes per search at once (the runner allows 8 in all). Pickaxe searches are CPU-bound. */
const PARALLEL: Readonly<Record<SearchKind, number>> = { path: 2, content: 3, regex: 3 };
const BATCH_TIMEOUT_MS = 120_000;

/**
 * diff-tree reads commit ids on stdin and prints `\x01<id>` plus the names of the matching files
 * for each commit, the header alone for a merge whose combined diff is empty, and nothing for the
 * rest. Rename detection stays off: it would read file contents, which a partial clone may lack.
 */
const DIFF_TREE = ['--stdin', '-r', '--root', '--no-renames', '--no-ext-diff', '--no-textconv', '--name-only', '--format=%x01%H'];

/**
 * Starts a search. A failure in the first batch (an invalid regex, file contents a partial clone
 * lacks) is thrown as an HttpError before anything streams, so the route can answer with it.
 */
export async function startSearch(
  git: GitRunner,
  repo: Repo,
  snapshot: RefsSnapshot,
  term: SearchTerm,
  scope: SearchScope,
  signal: AbortSignal,
  tuning: Partial<SearchTuning> = {},
): Promise<SearchRun> {
  const { firstBatch = FIRST_BATCH, batch = BATCH[term.kind], parallel = PARALLEL[term.kind] } = tuning;
  const commits = await commitList(git, repo, snapshot, scope, signal);
  const batches = split(commits, firstBatch, batch);
  // Stops the batches still running when the stream ends early or a batch fails.
  const work = new AbortController();
  const stop = () => work.abort();
  signal.addEventListener('abort', stop, { once: true });
  const run = (batch: readonly string[]) =>
    searchBatch(git, repo, term, batch, work.signal).catch(async (error: unknown) => {
      throw await explain(git, repo, term, error, signal);
    });

  let first: string[];
  try {
    first = batches.length > 0 ? await run(batches[0]!) : [];
  } catch (error) {
    stop();
    signal.removeEventListener('abort', stop);
    throw error;
  }

  const total = commits.length;
  async function* events(): AsyncGenerator<SearchEvent> {
    let searched = batches[0]?.length ?? 0;
    try {
      yield { type: 'progress', searched, total, matches: first };
      const rest = batches.slice(1).map((commits) => () => run(commits).then((matches) => ({ size: commits.length, matches })));
      for await (const result of inParallel(rest, parallel)) {
        searched += result.size;
        yield { type: 'progress', searched, total, matches: result.matches };
      }
      yield { type: 'done', searched, total };
    } catch (error) {
      if (signal.aborted) return; // the client left: nobody to tell
      yield error instanceof HttpError
        ? { type: 'error', error: error.code, message: error.message }
        : { type: 'error', error: 'search_failed', message: error instanceof Error ? error.message : String(error) };
    } finally {
      stop();
      signal.removeEventListener('abort', stop);
    }
  }
  return { total, events: events() };
}

/** The graph page's commits: the snapshot's tips, walked in the same order, up to the same limit. */
async function commitList(git: GitRunner, repo: Repo, snapshot: RefsSnapshot, scope: SearchScope, signal: AbortSignal): Promise<string[]> {
  if (snapshot.tips.length === 0) return [];
  const output = await git.text('rev-list', {
    cwd: repo.path,
    signal,
    input: `${snapshot.tips.join('\n')}\n`,
    args: [`--${scope.order}-order`, `--max-count=${scope.limit}`, '--stdin'],
  });
  return output.split('\n').filter((line) => line !== '');
}

function split(commits: readonly string[], first: number, size: number): string[][] {
  const batches: string[][] = [];
  for (let start = 0; start < commits.length; ) {
    const end = start + (batches.length === 0 ? first : size);
    batches.push(commits.slice(start, end));
    start = end;
  }
  return batches;
}

async function searchBatch(git: GitRunner, repo: Repo, term: SearchTerm, commits: readonly string[], signal: AbortSignal): Promise<string[]> {
  const output = await git.text('diff-tree', {
    cwd: repo.path,
    signal,
    input: `${commits.join('\n')}\n`,
    timeoutMs: BATCH_TIMEOUT_MS,
    ...filterFor(term),
  });
  return parseMatches(output);
}

/** The diff-tree options that select a term's commits. */
export function filterFor(term: SearchTerm): { args: string[]; paths?: string[]; literalPathspecs: boolean } {
  switch (term.kind) {
    case 'path': {
      // Relative to the repository's top folder, however it was typed.
      const path = term.value.replace(/^(?:\.?\/)+/, '') || '.';
      const glob = GLOB.test(path);
      // -c: merges are compared with all their parents at once (a combined diff).
      return { args: [...DIFF_TREE, '-c'], paths: [glob ? `:(glob)${path}` : path], literalPathspecs: !glob };
    }
    // The text is attached to its option (one argument), so git never reads it as an option of its own.
    case 'content':
      return { args: [...DIFF_TREE, `-S${term.value}`], literalPathspecs: true };
    case 'regex':
      return { args: [...DIFF_TREE, `-G${term.value}`, ...(term.ignoreCase ? ['-i'] : [])], literalPathspecs: true };
  }
}

const HEADER = /^\x01([0-9a-f]{40}|[0-9a-f]{64})$/;

/** The commits followed by at least one file name in diff-tree's output. */
export function parseMatches(output: string): string[] {
  const matches: string[] = [];
  let current: string | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('\x01')) {
      const header = HEADER.exec(line);
      if (!header) throw new Error(`unexpected git diff-tree output: ${JSON.stringify(line.slice(0, 80))}`);
      current = header[1]!;
    } else if (line !== '' && current !== null) {
      matches.push(current);
      current = null; // one match per commit, however many files
    }
  }
  return matches;
}

const INVALID_REGEX = /^fatal: invalid regex: (.*?)\r?$/m;

/** A git failure as something to tell the user, where there is something to tell. */
async function explain(git: GitRunner, repo: Repo, term: SearchTerm, error: unknown, signal: AbortSignal): Promise<unknown> {
  if (await isMissingObjectError(git, repo.path, error, signal).catch(() => false)) {
    return new HttpError(
      409,
      'objects_missing',
      `This repository is a partial clone, and ${term.kind}: search needs file contents that ` +
        `aren't stored locally. gittree doesn't download missing objects; path: search still works.`,
    );
  }
  const invalid = error instanceof GitError ? INVALID_REGEX.exec(error.stderr) : null;
  if (term.kind === 'regex' && invalid) {
    return new HttpError(
      400,
      'bad_regex',
      `Invalid regular expression: ${invalid[1]}. git uses POSIX extended regular expressions: [0-9] instead of \\d, no lookarounds.`,
    );
  }
  return error;
}

/** Runs tasks, at most `limit` at once, yielding each result as it arrives. */
async function* inParallel<T>(tasks: ReadonlyArray<() => Promise<T>>, limit: number): AsyncGenerator<T> {
  const running = new Map<number, Promise<readonly [number, T]>>();
  let next = 0;
  const launch = () => {
    const id = next++;
    const promise = tasks[id]!().then((value) => [id, value] as const);
    promise.catch(() => {}); // a failure surfaces through race() below
    running.set(id, promise);
  };
  while (next < tasks.length && running.size < limit) launch();
  while (running.size > 0) {
    const [id, value] = await Promise.race(running.values());
    running.delete(id);
    if (next < tasks.length) launch();
    yield value;
  }
}
