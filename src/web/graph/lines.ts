import { colorFor, DEFAULT_COLOR } from './colors.ts';
import { firstParent, type Dag, type GraphInput } from './dag.ts';

export type LineKind = 'default' | 'local' | 'remote' | 'head' | 'tag' | 'merged' | 'unknown';

/**
 * A branch line: the commits one ref's first-parent chain owns. Colors, hover
 * highlighting and the "line" shown in the summary panel all follow it.
 */
export interface Line {
  name: string;
  kind: LineKind;
  /** Index into the lane palette. */
  color: number;
  /** Refs drawn as this line, e.g. a branch and the remote branch it tracks. */
  refs: string[];
  /** Lines of merged branches without a ref: the merge commit that brought them in. */
  mergedBy?: number;
}

export interface Lines {
  list: Line[];
  /** The line (index into `list`) owning each row. */
  owner: Int32Array;
  /** Rows on the default branch's first-parent chain; the layout keeps them in lane 0. */
  mainline: Uint8Array;
  /** Row where the default branch's chain starts, or -1 when it isn't loaded. */
  mainlineTip: number;
  /** Ref name → its line. */
  byRef: Map<string, number>;
}

type InputRef = GraphInput['refs'][number];

/**
 * PLAN §7: a commit belongs to the ref whose first-parent chain reaches it
 * first — the default branch, then local branches (HEAD's first, newest tip
 * first), remote branches, a detached HEAD and tags. Commits of merged branches
 * that lost their ref get a line named from the merge message.
 */
export function assignLines(input: GraphInput): Lines {
  const { count } = input;
  const owner = new Int32Array(count).fill(-1);
  const mainline = new Uint8Array(count);
  const list: Line[] = [];
  const byRef = new Map<string, number>();
  const refByName = new Map(input.refs.map((ref) => [ref.name, ref]));

  const addLine = (line: Line) => list.push(line) - 1;
  const claim = (line: number, tip: number) => {
    for (let row = tip; row >= 0 && row < count && owner[row] === -1; row = firstParent(input, row)) owner[row] = line;
  };
  const byRecency = (a: InputRef, b: InputRef) => a.commit - b.commit || a.name.localeCompare(b.name);

  // 1. The default branch. Lane 0 starts at the local branch or at its remote twin when that one is
  //    ahead (fetched, not yet pulled), so new remote commits don't look like a side branch.
  let mainlineTip = -1;
  const main = input.defaultBranch === null ? undefined : refByName.get(input.defaultBranch);
  if (main) {
    const twin = main.kind === 'local' ? remoteTwin(main, refByName) : undefined;
    mainlineTip = twin && firstParentReaches(input, twin.commit, main.commit) ? twin.commit : main.commit;
    for (let row = mainlineTip; row >= 0 && row < count; row = firstParent(input, row)) mainline[row] = 1;

    const line = addLine({ name: main.name, kind: 'default', color: DEFAULT_COLOR, refs: [main.name] });
    byRef.set(main.name, line);
    claim(line, mainlineTip);
    if (twin) {
      // When the two diverged, the twin's own commits share the color, off lane 0.
      list[line]!.refs.push(twin.name);
      byRef.set(twin.name, line);
      claim(line, twin.commit);
    }
  }

  // 2. Local branches, each together with the remote branch it tracks.
  const locals = input.refs
    .filter((ref) => ref.kind === 'local' && !byRef.has(ref.name))
    .sort((a, b) => Number(b.name === input.head.branch) - Number(a.name === input.head.branch) || byRecency(a, b));
  for (const ref of locals) {
    const line = addLine({ name: ref.name, kind: 'local', color: colorFor(ref.name), refs: [ref.name] });
    byRef.set(ref.name, line);
    claim(line, ref.commit);
    const twin = remoteTwin(ref, refByName);
    if (twin && !byRef.has(twin.name)) {
      list[line]!.refs.push(twin.name);
      byRef.set(twin.name, line);
      claim(line, twin.commit);
    }
  }

  // 3. Remote branches nobody tracks. One named like an untracking local branch joins it.
  for (const ref of input.refs.filter((r) => r.kind === 'remote' && !byRef.has(r.name)).sort(byRecency)) {
    const shortName = ref.name.slice(ref.name.indexOf('/') + 1);
    const local = refByName.get(shortName);
    const localLine = local?.kind === 'local' && local.upstream === undefined ? byRef.get(shortName) : undefined;
    const line = localLine ?? addLine({ name: ref.name, kind: 'remote', color: colorFor(shortName), refs: [] });
    list[line]!.refs.push(ref.name);
    byRef.set(ref.name, line);
    claim(line, ref.commit);
  }

  // 4. A detached HEAD on commits no branch has.
  if (input.head.branch === null && input.head.row >= 0 && owner[input.head.row] === -1) {
    claim(addLine({ name: 'HEAD', kind: 'head', color: colorFor('HEAD'), refs: [] }), input.head.row);
  }

  // 5. Tags: usually on commits that already have a line, which their badge then uses.
  for (const ref of input.refs.filter((r) => r.kind === 'tag').sort(byRecency)) {
    const existing = ref.commit < count ? owner[ref.commit]! : -1;
    if (existing !== -1) {
      byRef.set(ref.name, existing);
      continue;
    }
    const line = addLine({ name: ref.name, kind: 'tag', color: colorFor(ref.name), refs: [ref.name] });
    byRef.set(ref.name, line);
    claim(line, ref.commit);
  }

  // 6. Merged branches whose ref was deleted. Top-down, every row already has a line when it's reached,
  //    so each unowned extra parent of a merge starts a new one.
  for (let row = 0; row < count; row++) {
    const start = input.parentStart[row]!;
    const end = input.parentStart[row + 1]!;
    if (end - start < 2) continue;
    let names: string[] | undefined;
    for (let k = start + 1; k < end; k++) {
      const parent = input.parentIdx[k]!;
      if (parent >= count || owner[parent] !== -1) continue;
      const subject = input.mergeSubjects.get(row) ?? '';
      names ??= parseMergeSources(subject);
      const name = names[k - start - 1] ?? (names.length === 1 ? names[0] : undefined);
      const line = addLine({
        name: name ?? 'merged branch',
        kind: 'merged',
        color: colorFor(name ?? `${subject}#${k - start}`),
        refs: [],
        mergedBy: row,
      });
      claim(line, parent);
    }
  }

  // 7. Nothing should be left, but never leave a row without a line.
  let unknown = -1;
  for (let row = 0; row < count; row++) {
    if (owner[row] !== -1) continue;
    if (unknown === -1) unknown = addLine({ name: 'unnamed', kind: 'unknown', color: colorFor('unnamed'), refs: [] });
    claim(unknown, row);
  }

  return { list, owner, mainline, mainlineTip, byRef };
}

/** The remote branch a local branch tracks, or origin/<same name>. */
function remoteTwin(ref: InputRef, refByName: ReadonlyMap<string, InputRef>): InputRef | undefined {
  const upstream = ref.upstream === undefined ? undefined : refByName.get(ref.upstream);
  if (upstream?.kind === 'remote') return upstream;
  if (ref.upstream !== undefined) return undefined;
  const origin = refByName.get(`origin/${ref.name}`);
  return origin?.kind === 'remote' ? origin : undefined;
}

/** Whether `target` is on the first-parent chain from `from`. Ancestors always have higher rows. */
function firstParentReaches(dag: Dag, from: number, target: number): boolean {
  for (let row = from; row >= 0 && row < dag.count && row <= target; row = firstParent(dag, row)) {
    if (row === target) return true;
  }
  return false;
}

/**
 * Branch names in a merge commit's subject, in parent order (for the second
 * parent onwards). Knows git's own messages and the GitHub, GitLab and
 * Bitbucket defaults.
 */
export function parseMergeSources(subject: string): string[] {
  const pullRequest = /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject);
  if (pullRequest) return [pullRequest[1] as string];
  const bitbucket = /^Merged in (\S+)/.exec(subject);
  if (bitbucket) return [bitbucket[1] as string];
  const branches = /^Merge (?:remote-tracking )?branch(?:es)? (.+)$/.exec(subject);
  if (branches) {
    const list = (branches[1] as string).replace(/ into .*$/, '');
    return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
  }
  const tagOrCommit = /^Merge (?:tag|commit) '([^']+)'/.exec(subject);
  return tagOrCommit ? [tagOrCommit[1] as string] : [];
}
