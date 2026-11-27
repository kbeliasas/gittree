import { firstParent, type Dag, type DagWithChildren } from './dag.ts';

/** `start` and every commit reachable from it (loaded rows only), as a 0/1 mask. */
export function ancestors(dag: Dag, start: number): Uint8Array {
  const seen = new Uint8Array(dag.count);
  if (start < 0 || start >= dag.count) return seen;
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const row = stack.pop()!;
    for (let k = dag.parentStart[row]!; k < dag.parentStart[row + 1]!; k++) {
      const parent = dag.parentIdx[k]!;
      if (parent < dag.count && !seen[parent]) {
        seen[parent] = 1;
        stack.push(parent);
      }
    }
  }
  return seen;
}

/** `start` and every commit that has it as an ancestor. */
export function descendants(dag: DagWithChildren, start: number): Uint8Array {
  const seen = new Uint8Array(dag.count);
  if (start < 0 || start >= dag.count) return seen;
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const row = stack.pop()!;
    for (let k = dag.childStart[row]!; k < dag.childStart[row + 1]!; k++) {
      const kid = dag.childIdx[k]!;
      if (!seen[kid]) {
        seen[kid] = 1;
        stack.push(kid);
      }
    }
  }
  return seen;
}

export interface BranchFocus {
  /** The branch's own commits: reachable from it, but not from the default branch (before it was merged). */
  own: Uint8Array;
  ownCount: number;
  /** Where the branch's first-parent chain leaves its own commits: the commit it started from, or -1. */
  fork: number;
  /** The default-branch commit that merged it, or -1 when it isn't merged. */
  merge: number;
}

/**
 * PLAN §7 "focus a branch". For an unmerged branch, its own commits are those
 * the default branch can't reach. For a merged one, the default branch reaches
 * everything, so they are what the merge brought in: reachable from the tip but
 * not from the merge's first parent.
 */
export function focusBranch(dag: DagWithChildren, mainline: Uint8Array, mainlineTip: number, tip: number): BranchFocus {
  const own = new Uint8Array(dag.count);
  if (tip < 0 || tip >= dag.count || mainline[tip]) return { own, ownCount: 0, fork: -1, merge: -1 };

  // The oldest default-branch commit that has the tip as an ancestor is the merge.
  const later = descendants(dag, tip);
  let merge = -1;
  for (let row = 0; row < tip; row++) if (mainline[row] && later[row]) merge = row;

  const base = ancestors(dag, merge >= 0 ? firstParent(dag, merge) : mainlineTip);
  const reach = ancestors(dag, tip);
  let ownCount = 0;
  for (let row = 0; row < dag.count; row++) {
    if (reach[row] && !base[row]) {
      own[row] = 1;
      ownCount++;
    }
  }

  let fork = -1;
  for (let row = tip; row >= 0 && row < dag.count; row = firstParent(dag, row)) {
    if (!own[row]) {
      fork = row;
      break;
    }
  }
  return { own, ownCount, fork, merge };
}

export interface MergedCommits {
  /** What the merge brought in: reachable from its other parents but not from its first parent. */
  rows: Uint8Array;
  count: number;
  /** The merged commit with the oldest author time, or -1. */
  oldest: number;
  /** Part of the history is older than the loaded commits, so `count` may be off. */
  partial: boolean;
}

/** Whether any row in `mask` has a parent that isn't loaded. */
function reachesUnloaded(dag: Dag, mask: Uint8Array): boolean {
  for (let row = 0; row < dag.count; row++) {
    if (mask[row] && dag.parentStart[row + 1]! > dag.parentStart[row]!) {
      for (let k = dag.parentStart[row]!; k < dag.parentStart[row + 1]!; k++) if (dag.parentIdx[k]! >= dag.count) return true;
    }
  }
  return false;
}

/**
 * PLAN §8: a merge's merged commits (`M^1..M^2`, and `M^1..M^n` for octopus
 * merges) and, through the oldest of them, how long the branch lived.
 */
export function mergedCommits(dag: Dag, row: number, authorTime: (row: number) => number): MergedCommits {
  const rows = new Uint8Array(dag.count);
  const result: MergedCommits = { rows, count: 0, oldest: -1, partial: false };
  const start = dag.parentStart[row]!;
  const end = dag.parentStart[row + 1]!;
  if (end - start < 2) return result;

  const firstParentRow = dag.parentIdx[start]!;
  const base = ancestors(dag, firstParentRow);
  // Without the first parent's whole history, some "merged" commits may really be on it.
  result.partial = firstParentRow >= dag.count || reachesUnloaded(dag, base);
  const stack: number[] = [];
  const visit = (candidate: number) => {
    if (candidate >= dag.count) result.partial = true;
    else if (!base[candidate] && !rows[candidate]) {
      rows[candidate] = 1;
      stack.push(candidate);
    }
  };
  for (let k = start + 1; k < end; k++) visit(dag.parentIdx[k]!);
  while (stack.length > 0) {
    const current = stack.pop()!;
    result.count++;
    if (result.oldest === -1 || authorTime(current) < authorTime(result.oldest)) result.oldest = current;
    for (let k = dag.parentStart[current]!; k < dag.parentStart[current + 1]!; k++) visit(dag.parentIdx[k]!);
  }
  return result;
}

/** Refs (by the row they point at) whose history contains `row`: the refs on it and on its descendants. */
export function containedIn<Ref extends { commit: number }>(dag: DagWithChildren, row: number, refs: readonly Ref[], offset = 0): Ref[] {
  const later = descendants(dag, row);
  return refs.filter((ref) => {
    const at = ref.commit - offset;
    return at >= 0 && at < dag.count && later[at] === 1;
  });
}
