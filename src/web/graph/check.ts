import type { Dag } from './dag.ts';
import { SEG_IN, SEG_OUT, SEG_PASS, type Layout } from './layout.ts';
import type { Lines } from './lines.ts';

/**
 * Layout invariants (PLAN §11), as a list of problems — empty when the layout
 * is sound. Used by unit tests on fixtures and on random graphs.
 *  - every row has one node, inside the graph's width;
 *  - lanes are continuous: what leaves a row's bottom edge enters the next row's top edge;
 *  - every parent edge is drawn, from the child's node down its lane into the parent's node;
 *  - the default branch's first-parent chain stays in lane 0, and nothing else uses lane 0;
 *  - a lane that ends in a commit isn't reused by an edge leaving that same commit.
 */
export function checkLayout(dag: Dag, lines: Pick<Lines, 'mainline' | 'mainlineTip'>, layout: Layout): string[] {
  const problems: string[] = [];
  const { count } = dag;
  const segs = (r: number) => {
    const list: number[] = [];
    for (let s = layout.segStart[r]!; s < layout.segStart[r + 1]!; s++) list.push(s);
    return list;
  };
  const hasMainline = lines.mainlineTip >= 0;

  for (let r = 0; r < count; r++) {
    const col = layout.lane[r]!;
    if (col < 0 || col >= layout.width) problems.push(`row ${r}: node lane ${col} outside width ${layout.width}`);
    if (hasMainline && (lines.mainline[r] === 1) !== (col === 0)) {
      problems.push(`row ${r}: ${lines.mainline[r] ? 'default-branch commit outside' : 'other commit in'} lane 0`);
    }

    const closing = new Set<number>();
    const top = new Map<number, number>();
    const bottom = new Map<number, number>();
    const claim = (side: Map<number, number>, lane: number, parent: number, what: string) => {
      const existing = side.get(lane);
      if (existing !== undefined && existing !== parent) problems.push(`row ${r}: lane ${lane} carries two parents (${what})`);
      side.set(lane, parent);
    };
    for (const s of segs(r)) {
      const from = layout.segFrom[s]!;
      const to = layout.segTo[s]!;
      const parent = layout.segParent[s]!;
      switch (layout.segKind[s]) {
        case SEG_PASS:
          if (from !== to) problems.push(`row ${r}: pass segment changes lanes`);
          if (parent <= r) problems.push(`row ${r}: pass segment heads for row ${parent}, not below`);
          claim(top, from, parent, 'top');
          claim(bottom, to, parent, 'bottom');
          if (hasMainline && from === 0 && parent < count && !lines.mainline[parent]) problems.push(`row ${r}: lane 0 heads for row ${parent}`);
          break;
        case SEG_IN:
          if (to !== col || parent !== r) problems.push(`row ${r}: incoming segment misses the node`);
          claim(top, from, parent, 'top');
          if (from !== to) closing.add(from);
          break;
        case SEG_OUT:
          if (from !== col || layout.segChild[s] !== r) problems.push(`row ${r}: outgoing segment doesn't start at the node`);
          claim(bottom, to, parent, 'bottom');
          if (hasMainline && to === 0 && parent < count && !lines.mainline[parent]) problems.push(`row ${r}: edge into lane 0 heads for row ${parent}`);
          break;
      }
    }
    for (const lane of closing) {
      if (bottom.has(lane)) problems.push(`row ${r}: lane ${lane} ends here and is reused in the same row`);
    }

    if (r + 1 < count) {
      const nextTop = new Map<number, number>();
      for (const s of segs(r + 1)) {
        if (layout.segKind[s] !== SEG_OUT) nextTop.set(layout.segFrom[s]!, layout.segParent[s]!);
      }
      const keys = (m: Map<number, number>) => [...m.keys()].sort((a, b) => a - b).join(',');
      if (keys(bottom) !== keys(nextTop)) {
        problems.push(`rows ${r}/${r + 1}: lanes [${keys(bottom)}] don't continue as [${keys(nextTop)}]`);
      } else {
        for (const [lane, parent] of bottom) {
          if (nextTop.get(lane) !== parent) problems.push(`rows ${r}/${r + 1}: lane ${lane} changes target`);
        }
      }
    }
  }

  // Follow every edge from its child down to its parent.
  for (let r = 0; r < count; r++) {
    const seen = new Set<number>();
    for (let k = dag.parentStart[r]!; k < dag.parentStart[r + 1]!; k++) {
      const parent = dag.parentIdx[k]!;
      if (seen.has(parent)) continue;
      seen.add(parent);
      const out = segs(r).find((s) => layout.segKind[s] === SEG_OUT && layout.segParent[s] === parent);
      if (out === undefined) {
        problems.push(`row ${r}: no edge to parent ${parent}`);
        continue;
      }
      const lane = layout.segTo[out]!;
      const last = Math.min(parent, count);
      for (let q = r + 1; q < last; q++) {
        const pass = segs(q).some((s) => layout.segKind[s] === SEG_PASS && layout.segFrom[s] === lane && layout.segParent[s] === parent);
        if (!pass) {
          problems.push(`edge ${r}→${parent}: lane ${lane} interrupted at row ${q}`);
          break;
        }
      }
      if (parent < count) {
        const arrives = segs(parent).some((s) => layout.segKind[s] === SEG_IN && layout.segFrom[s] === lane);
        if (!arrives) problems.push(`edge ${r}→${parent}: lane ${lane} never reaches the parent`);
      }
    }
  }
  return problems;
}
