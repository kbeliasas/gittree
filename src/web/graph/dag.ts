import type { RefKind } from '../../shared/api.ts';

/**
 * The commit graph as compact arrays, rows newest first. Parents of row r are
 * `parentIdx[parentStart[r] .. parentStart[r + 1])`, first parent first; a value
 * ≥ `count` is a parent that isn't loaded (older than the loaded page).
 */
export interface Dag {
  count: number;
  parentStart: Int32Array;
  parentIdx: Int32Array;
}

export interface DagWithChildren extends Dag {
  /** Children of row r (loaded rows only), newest first. */
  childStart: Int32Array;
  childIdx: Int32Array;
}

/** What the layout worker needs: plain data that survives postMessage. */
export interface GraphInput extends Dag {
  refs: ReadonlyArray<{ name: string; kind: RefKind; commit: number; upstream?: string }>;
  defaultBranch: string | null;
  head: { row: number; branch: string | null };
  /** Subjects of merge commits by row, to name merged branches that no longer have a ref. */
  mergeSubjects: ReadonlyMap<number, string>;
}

export function firstParent(dag: Dag, row: number): number {
  const start = dag.parentStart[row] as number;
  return start < (dag.parentStart[row + 1] as number) ? (dag.parentIdx[start] as number) : -1;
}

export function parentCount(dag: Dag, row: number): number {
  return (dag.parentStart[row + 1] as number) - (dag.parentStart[row] as number);
}

/** Builds the reverse (children) index. */
export function withChildren(dag: Dag): DagWithChildren {
  const { count, parentStart, parentIdx } = dag;
  const childStart = new Int32Array(count + 1);
  for (const p of parentIdx) {
    if (p < count) childStart[p + 1] = (childStart[p + 1] as number) + 1;
  }
  for (let r = 0; r < count; r++) childStart[r + 1] = (childStart[r + 1] as number) + (childStart[r] as number);
  const next = childStart.slice(0, count);
  const childIdx = new Int32Array(childStart[count] as number);
  for (let r = 0; r < count; r++) {
    for (let k = parentStart[r] as number; k < (parentStart[r + 1] as number); k++) {
      const p = parentIdx[k] as number;
      if (p >= count) continue;
      const slot = next[p] as number;
      childIdx[slot] = r;
      next[p] = slot + 1;
    }
  }
  return { ...dag, childStart, childIdx };
}
