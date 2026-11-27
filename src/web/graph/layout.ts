import type { Dag } from './dag.ts';
import type { Lines } from './lines.ts';

/** A lane passing through a row without touching its commit: top edge to bottom edge. */
export const SEG_PASS = 0;
/** A lane ending in the row's commit: top edge to the node. */
export const SEG_IN = 1;
/** An edge leaving the row's commit for a parent: node to bottom edge. */
export const SEG_OUT = 2;

/**
 * Where every commit and line segment goes. Each row is drawn on its own from
 * its segments (which never leave the row), so a virtualized list can render
 * any slice of rows independently.
 *
 * Segments are stored as parallel arrays; row r owns `segStart[r] .. segStart[r + 1]`.
 */
export interface Layout {
  /** Lanes used: the graph is `width` lanes wide. */
  width: number;
  /** The node's lane, per row. */
  lane: Int32Array;
  segStart: Int32Array;
  /** SEG_PASS, SEG_IN or SEG_OUT. */
  segKind: Uint8Array;
  /** Lane at the segment's start: its top edge, or the node for SEG_OUT. */
  segFrom: Int32Array;
  /** Lane at the segment's end: its bottom edge, or the node for SEG_IN. */
  segTo: Int32Array;
  /** The edge's child (newer) row. */
  segChild: Int32Array;
  /** A second edge sharing the lane after a merge joined it, or -1. */
  segChild2: Int32Array;
  /** The edge's parent (older) row; ≥ count for a parent that isn't loaded. */
  segParent: Int32Array;
  /** The branch line the segment belongs to: color and hover follow it. */
  segLine: Int32Array;
}

const FREE = -1;
/** A lane that ended in this row's commit: free again from the next row, so its curve isn't reused. */
const CLOSING = -2;

/**
 * PLAN §7 lane assignment. Walk commits newest → oldest with `target[lane]` =
 * the commit each lane is heading for:
 *  1. A commit takes the leftmost lane heading for it, or the first free lane
 *     (a branch tip). Other lanes heading for it end there (fork edges).
 *  2. Its first parent continues in the same lane; each extra parent (merge)
 *     joins the lane already heading for it or opens a new one.
 *  3. Lane 0 is reserved for the default branch's first-parent chain, so main
 *     is a straight line on the left.
 */
export function computeLayout(dag: Dag, lines: Pick<Lines, 'owner' | 'mainline' | 'mainlineTip'>): Layout {
  const { count, parentStart, parentIdx } = dag;
  const { owner, mainline } = lines;
  const firstLane = lines.mainlineTip >= 0 ? 1 : 0;

  const target: number[] = [];
  const child: number[] = [];
  const child2: number[] = [];
  const lineOf: number[] = [];
  const lane = new Int32Array(count);
  const segStart = new Int32Array(count + 1);
  const segs = new SegmentBuffer(count * 3 + 16);

  const freeLane = (): number => {
    while (target.length < firstLane) addLane(); // the reserved lane 0 exists even before main starts
    for (let i = firstLane; i < target.length; i++) if (target[i] === FREE) return i;
    return addLane();
  };
  const addLane = (): number => {
    target.push(FREE);
    child.push(-1);
    child2.push(-1);
    lineOf.push(-1);
    return target.length - 1;
  };

  for (let r = 0; r < count; r++) {
    segStart[r] = segs.length;

    // 1. The commit's lane.
    let col = -1;
    if (mainline[r]) col = 0;
    else col = target.indexOf(r);
    if (col === -1) col = freeLane();
    while (target.length <= col) addLane();
    lane[r] = col;

    // Top half: lanes passing by, and lanes ending in this commit.
    for (let i = 0; i < target.length; i++) {
      const t = target[i]!;
      if (t < 0) continue;
      if (t === r) {
        segs.push(SEG_IN, i, col, child[i]!, child2[i]!, r, lineOf[i]!);
        target[i] = i === col ? FREE : CLOSING;
      } else {
        segs.push(SEG_PASS, i, i, child[i]!, child2[i]!, t, lineOf[i]!);
      }
    }

    // 2. Bottom half: an edge to each parent.
    const start = parentStart[r]!;
    const end = parentStart[r + 1]!;
    for (let k = start; k < end; k++) {
      const p = parentIdx[k]!;
      if (k > start && p === parentIdx[start]) continue; // a duplicate parent is drawn once
      // A first-parent edge continues the commit's own line; a merge edge belongs to the merged line.
      const line = k === start || p >= count ? owner[r]! : owner[p]!;
      let to: number;
      if (k === start) {
        to = col;
      } else {
        to = target.indexOf(p);
        if (to !== -1) {
          child2[to] = r; // join the lane that already leads to this parent
          segs.push(SEG_OUT, col, to, r, -1, p, line);
          continue;
        }
        to = freeLane();
      }
      target[to] = p;
      child[to] = r;
      child2[to] = -1;
      lineOf[to] = line;
      segs.push(SEG_OUT, col, to, r, -1, p, line);
    }

    for (let i = 0; i < target.length; i++) if (target[i] === CLOSING) target[i] = FREE;
  }
  segStart[count] = segs.length;

  const result = segs.finish();
  let width = 0;
  for (let r = 0; r < count; r++) width = Math.max(width, lane[r]! + 1);
  for (let s = 0; s < result.segKind.length; s++) width = Math.max(width, result.segFrom[s]! + 1, result.segTo[s]! + 1);
  return { width, lane, segStart, ...result };
}

/** Growable parallel arrays for segments. */
class SegmentBuffer {
  length = 0;
  #kind: Uint8Array;
  #from: Int32Array;
  #to: Int32Array;
  #child: Int32Array;
  #child2: Int32Array;
  #parent: Int32Array;
  #line: Int32Array;

  constructor(capacity: number) {
    this.#kind = new Uint8Array(capacity);
    this.#from = new Int32Array(capacity);
    this.#to = new Int32Array(capacity);
    this.#child = new Int32Array(capacity);
    this.#child2 = new Int32Array(capacity);
    this.#parent = new Int32Array(capacity);
    this.#line = new Int32Array(capacity);
  }

  push(kind: number, from: number, to: number, child: number, child2: number, parent: number, line: number): void {
    if (this.length === this.#kind.length) this.#grow();
    const i = this.length++;
    this.#kind[i] = kind;
    this.#from[i] = from;
    this.#to[i] = to;
    this.#child[i] = child;
    this.#child2[i] = child2;
    this.#parent[i] = parent;
    this.#line[i] = line;
  }

  finish(): Pick<Layout, 'segKind' | 'segFrom' | 'segTo' | 'segChild' | 'segChild2' | 'segParent' | 'segLine'> {
    const n = this.length;
    return {
      segKind: this.#kind.slice(0, n),
      segFrom: this.#from.slice(0, n),
      segTo: this.#to.slice(0, n),
      segChild: this.#child.slice(0, n),
      segChild2: this.#child2.slice(0, n),
      segParent: this.#parent.slice(0, n),
      segLine: this.#line.slice(0, n),
    };
  }

  #grow(): void {
    const size = this.#kind.length * 2;
    const grow = <T extends Uint8Array | Int32Array>(array: T, make: (n: number) => T): T => {
      const bigger = make(size);
      bigger.set(array);
      return bigger;
    };
    this.#kind = grow(this.#kind, (n) => new Uint8Array(n));
    this.#from = grow(this.#from, (n) => new Int32Array(n));
    this.#to = grow(this.#to, (n) => new Int32Array(n));
    this.#child = grow(this.#child, (n) => new Int32Array(n));
    this.#child2 = grow(this.#child2, (n) => new Int32Array(n));
    this.#parent = grow(this.#parent, (n) => new Int32Array(n));
    this.#line = grow(this.#line, (n) => new Int32Array(n));
  }
}
