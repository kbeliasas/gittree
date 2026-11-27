import { firstParent, withChildren, type Dag, type DagWithChildren } from './dag.ts';
import { computeLayout, type Layout } from './layout.ts';
import type { Lines } from './lines.ts';

/** The parts of the full graph's branch lines a view needs; `list` and `byRef` are shared. */
export type LineRows = Pick<Lines, 'owner' | 'mainline' | 'mainlineTip'>;

/**
 * Some of the graph's commits, laid out on their own (PLAN §7: hiding search
 * misses; later topology-only, first-parent and branch visibility). Each kept
 * commit is linked to its nearest kept ancestors, so lines stay connected
 * through hidden commits, like git's parent rewriting. View rows keep the
 * graph's order.
 */
export interface GraphView {
  /** The graph row of each view row. */
  rows: Int32Array;
  /** The view row of each graph row, or -1 when it is hidden. */
  viewOf: Int32Array;
  dag: DagWithChildren;
  /** Owner per view row (the graph's lines); lane 0 is the default branch's first kept commit and its first parents. */
  lines: LineRows;
  layout: Layout;
}

/**
 * The kept rows with rewritten parents. A parent that isn't loaded stays a
 * parent that isn't loaded (≥ the view's count, in the same order).
 *
 * A kept commit's first parent becomes the nearest kept commit on its
 * first-parent chain, so lines continue where they did. Its other parents are
 * the nearest kept commits beyond hidden ones, minus any that are ancestors of
 * another: those edges would add nothing (like `--simplify-merges`).
 */
export function subgraph(dag: Dag, keep: Uint8Array): { rows: Int32Array; viewOf: Int32Array; dag: Dag } {
  const { count, parentStart, parentIdx } = dag;
  const viewOf = new Int32Array(count).fill(-1);
  let viewCount = 0;
  for (let r = 0; r < count; r++) if (keep[r]) viewOf[r] = viewCount++;
  const rows = new Int32Array(viewCount);
  for (let r = 0; r < count; r++) if (viewOf[r]! >= 0) rows[viewOf[r]!] = r;
  const target = (p: number) => (p >= count ? viewCount + (p - count) : viewOf[p]!);

  // Built bottom-up: a row's parents are always below it, so they are done first.
  const viewParents: number[][] = new Array<number[]>(viewCount);
  /** Hidden rows: the nearest kept commit on their first-parent chain (-1: none) … */
  const firstOf = new Int32Array(count).fill(-1);
  /** … and other nearest kept ancestors. */
  const othersOf: Array<readonly number[] | undefined> = new Array<readonly number[] | undefined>(count);

  const stamp = new Int32Array(viewCount);
  let generation = 0;
  /** Whether view row `to` is an ancestor of view row `from`. Ancestors have higher rows, which bounds the search. */
  const reaches = (from: number, to: number): boolean => {
    if (from >= viewCount || to <= from) return false;
    generation++;
    const stack = [from];
    while (stack.length > 0) {
      for (const p of viewParents[stack.pop()!]!) {
        if (p === to) return true;
        if (p < to && p < viewCount && stamp[p] !== generation) {
          stamp[p] = generation;
          stack.push(p);
        }
      }
    }
    return false;
  };
  const reduce = (first: number, candidates: readonly number[]): number[] => {
    const unique = [...new Set(candidates)].filter((x) => x !== first);
    if (unique.length === 0) return unique;
    const all = first >= 0 ? [first, ...unique] : unique;
    return unique.filter((x) => !all.some((y) => y !== x && reaches(y, x)));
  };

  for (let r = count - 1; r >= 0; r--) {
    const start = parentStart[r]!;
    const end = parentStart[r + 1]!;
    let first = -1;
    let others: readonly number[] = [];
    if (end - start === 1 && !keep[r]) {
      // The common case, a hidden commit with one parent: it passes its parent's answer on.
      const p = parentIdx[start]!;
      if (p >= count || keep[p]) firstOf[r] = target(p);
      else {
        firstOf[r] = firstOf[p]!;
        othersOf[r] = othersOf[p];
      }
      continue;
    }
    const candidates: number[] = [];
    for (let k = start; k < end; k++) {
      const p = parentIdx[k]!;
      const direct = p >= count || keep[p] === 1;
      const pFirst = direct ? target(p) : firstOf[p]!;
      const pOthers = direct ? undefined : othersOf[p];
      if (k === start) first = pFirst;
      else if (pFirst >= 0) candidates.push(pFirst);
      if (pOthers) candidates.push(...pOthers);
    }
    others = reduce(first, candidates);
    if (keep[r]) {
      viewParents[viewOf[r]!] = first >= 0 ? [first, ...others] : [...others];
    } else {
      firstOf[r] = first;
      if (others.length > 0) othersOf[r] = others;
    }
  }

  const viewStart = new Int32Array(viewCount + 1);
  let total = 0;
  for (let v = 0; v < viewCount; v++) {
    viewStart[v] = total;
    total += viewParents[v]!.length;
  }
  viewStart[viewCount] = total;
  const viewIdx = new Int32Array(total);
  let k = 0;
  for (let v = 0; v < viewCount; v++) for (const p of viewParents[v]!) viewIdx[k++] = p;
  return { rows, viewOf, dag: { count: viewCount, parentStart: viewStart, parentIdx: viewIdx } };
}

/** Lays out the kept rows of the graph. */
export function buildView(dag: Dag, lines: LineRows, keep: Uint8Array): GraphView {
  const sub = subgraph(dag, keep);
  const viewDag = withChildren(sub.dag);
  const owner = new Int32Array(viewDag.count);
  for (let v = 0; v < viewDag.count; v++) owner[v] = lines.owner[sub.rows[v]!]!;

  // Lane 0 starts at the default branch's first kept commit and follows the view's first parents.
  let mainlineTip = -1;
  for (let r = lines.mainlineTip; r >= 0 && r < dag.count; r = firstParent(dag, r)) {
    if (sub.viewOf[r]! >= 0) {
      mainlineTip = sub.viewOf[r]!;
      break;
    }
  }
  const mainline = new Uint8Array(viewDag.count);
  for (let v = mainlineTip; v >= 0 && v < viewDag.count; v = firstParent(viewDag, v)) mainline[v] = 1;

  const viewLines: LineRows = { owner, mainline, mainlineTip };
  return { rows: sub.rows, viewOf: sub.viewOf, dag: viewDag, lines: viewLines, layout: computeLayout(viewDag, viewLines) };
}

/** Every row shown: the graph itself. */
export function fullView(dag: DagWithChildren, lines: LineRows, layout: Layout): GraphView {
  const rows = new Int32Array(dag.count);
  for (let r = 0; r < dag.count; r++) rows[r] = r;
  return { rows, viewOf: rows, dag, lines, layout };
}

/** The typed-array buffers in a view, to transfer instead of copy. */
export function viewTransferables(view: GraphView): ArrayBuffer[] {
  const { layout } = view;
  return [
    view.rows,
    view.viewOf,
    view.dag.parentStart,
    view.dag.parentIdx,
    view.dag.childStart,
    view.dag.childIdx,
    view.lines.owner,
    view.lines.mainline,
    layout.lane,
    layout.segStart,
    layout.segKind,
    layout.segFrom,
    layout.segTo,
    layout.segChild,
    layout.segChild2,
    layout.segParent,
    layout.segLine,
  ].map((array) => array.buffer as ArrayBuffer);
}
