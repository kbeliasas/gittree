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
