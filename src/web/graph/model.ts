import type { GraphCommit, GraphPayload, GraphRef } from '../../shared/api.ts';
import { firstParent, withChildren, type DagWithChildren, type GraphInput } from './dag.ts';

/** A graph page turned into arrays and lookups the views use. */
export interface GraphModel extends DagWithChildren {
  payload: GraphPayload;
  commits: GraphCommit[];
  /** Hashes of parents that aren't loaded; parent index `count + i` is `unloaded[i]`. */
  unloaded: string[];
  /** Full hash → row. */
  rowOf: Map<string, number>;
  /** Refs by the row they point at. */
  refsAt: Map<number, GraphRef[]>;
  /** HEAD's row, or -1 (no commits, or HEAD isn't loaded). */
  headRow: number;
  /** The whole graph has more commits than are loaded. */
  truncated: boolean;
}

export function toModel(payload: GraphPayload): GraphModel {
  const { commits } = payload;
  const count = commits.length;
  const offset = payload.page.offset;
  const rowOf = new Map(commits.map((commit, row) => [commit.sha, row]));

  const unloaded: string[] = [];
  const unloadedIndex = new Map<string, number>();
  const parentStart = new Int32Array(count + 1);
  let parentTotal = 0;
  for (let row = 0; row < count; row++) {
    parentStart[row] = parentTotal;
    parentTotal += commits[row]!.parents.length;
  }
  parentStart[count] = parentTotal;

  const parentIdx = new Int32Array(parentTotal);
  let k = 0;
  for (const commit of commits) {
    for (const parent of commit.parents) {
      let row = typeof parent === 'number' ? parent - offset : (rowOf.get(parent) ?? -1);
      if (row < 0 || row >= count) {
        // On a later page (or missing): one shared virtual row per distinct parent.
        const sha = typeof parent === 'string' ? parent : `#${parent}`;
        let index = unloadedIndex.get(sha);
        if (index === undefined) {
          index = unloaded.push(sha) - 1;
          unloadedIndex.set(sha, index);
        }
        row = count + index;
      }
      parentIdx[k++] = row;
    }
  }

  const refsAt = new Map<number, GraphRef[]>();
  for (const ref of payload.refs) {
    const row = ref.commit - offset;
    const list = refsAt.get(row);
    if (list) list.push(ref);
    else refsAt.set(row, [ref]);
  }

  return {
    ...withChildren({ count, parentStart, parentIdx }),
    payload,
    commits,
    unloaded,
    rowOf,
    refsAt,
    headRow: payload.head.sha === null ? -1 : (rowOf.get(payload.head.sha) ?? -1),
    truncated: payload.page.total > offset + count,
  };
}

/** The plain data the layout worker needs. */
export function toGraphInput(model: GraphModel): GraphInput {
  const offset = model.payload.page.offset;
  const mergeSubjects = new Map<number, string>();
  model.commits.forEach((commit, row) => {
    if (commit.parents.length > 1) mergeSubjects.set(row, commit.subject);
  });
  return {
    count: model.count,
    parentStart: model.parentStart,
    parentIdx: model.parentIdx,
    refs: model.payload.refs.map((ref) => ({
      name: ref.name,
      kind: ref.kind,
      commit: ref.commit - offset,
      ...(ref.upstream !== undefined ? { upstream: ref.upstream } : {}),
    })),
    defaultBranch: model.payload.defaultBranch,
    head: { row: model.headRow, branch: model.payload.head.branch },
    mergeSubjects,
  };
}

/**
 * Children of a row, the one continuing its line first: the first-parent child
 * in the same lane, then other first-parent children (branches started here),
 * then merges that pulled it in; nearest first within each group.
 */
export function childrenByLine(dag: DagWithChildren, lane: Int32Array, row: number): number[] {
  const rank = (child: number) => {
    if (firstParent(dag, child) !== row) return 2;
    return lane[child] === lane[row] ? 0 : 1;
  };
  const children: number[] = [];
  for (let k = dag.childStart[row]!; k < dag.childStart[row + 1]!; k++) children.push(dag.childIdx[k]!);
  return children.sort((a, b) => rank(a) - rank(b) || b - a);
}

/** The row for a full or abbreviated (≥ 4 characters) hash, or -1. */
export function findRow(model: GraphModel, sha: string): number {
  const exact = model.rowOf.get(sha);
  if (exact !== undefined) return exact;
  if (sha.length < 4) return -1;
  return model.commits.findIndex((commit) => commit.sha.startsWith(sha));
}
