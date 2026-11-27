import { describe, expect, it } from 'vitest';

import { analyzeGraph } from './analyze.ts';
import { renderAscii } from './ascii.ts';
import { checkLayout } from './check.ts';
import { firstParent, withChildren } from './dag.ts';
import { ancestors } from './reach.ts';
import { build, randomHistory, seededRandom, type Built } from './testing.ts';
import { buildView, subgraph, type GraphView } from './view.ts';

const keepOnly = (graph: Built, names: string[]) => {
  const keep = new Uint8Array(graph.rows.length);
  for (const name of names) keep[graph.row(name)] = 1;
  return keep;
};

/** Each kept commit with its parents in the view, by name ("X…" for parents that aren't loaded). */
const parentsByName = (graph: Built, names: string[]) => {
  const sub = subgraph(graph.input, keepOnly(graph, names));
  const name = (v: number) => (v < sub.dag.count ? graph.rows[sub.rows[v]!]! : `unloaded#${v - sub.dag.count}`);
  return Object.fromEntries(
    [...sub.rows].map((row, v) => [
      graph.rows[row],
      Array.from(sub.dag.parentIdx.slice(sub.dag.parentStart[v], sub.dag.parentStart[v + 1]), name).join(' '),
    ]),
  );
};

const view = (graph: Built, names: string[]): GraphView => {
  const result = buildView(graph.input, graph.analysis.lines, keepOnly(graph, names));
  expect(checkLayout(result.dag, result.lines, result.layout)).toEqual([]);
  return result;
};

const ascii = (graph: Built, result: GraphView) =>
  renderAscii(
    result.layout,
    [...result.rows].map((row, v) => ({
      subject: graph.rows[row]!,
      merge: result.dag.parentStart[v + 1]! - result.dag.parentStart[v]! > 1,
    })),
  );

describe('subgraph', () => {
  it('bridges hidden commits', () => {
    expect(parentsByName(build('C: B\nB: A\nA:'), ['C', 'A'])).toEqual({ C: 'A', A: '' });
  });

  it('keeps a merge of kept commits, first parent first', () => {
    const graph = build('M: D F2\nF2: F1\nD: B\nF1: B\nB: A\nA:', { main: 'M' });
    expect(parentsByName(graph, ['M', 'F1', 'A'])).toEqual({ M: 'A F1', F1: 'A', A: '' });
    expect(parentsByName(graph, ['M', 'A'])).toEqual({ M: 'A', A: '' }); // both sides lead to A: one edge
  });

  it('drops a side parent that is already an ancestor of another parent', () => {
    const graph = build('A: H\nH: P Q\nP: C\nQ: E\nC: E\nE:');
    expect(parentsByName(graph, ['A', 'C', 'E'])).toEqual({ A: 'C', C: 'E', E: '' });
  });

  it('keeps the first parent even when a side parent descends from it', () => {
    const graph = build('A: B S\nB: E\nS: E\nE:');
    expect(parentsByName(graph, ['A', 'S', 'E'])).toEqual({ A: 'E S', S: 'E', E: '' });
    // With nothing kept on the first-parent chain, the side becomes the first parent.
    expect(parentsByName(graph, ['A', 'S'])).toEqual({ A: 'S', S: '' });
  });

  it('keeps parents that are not loaded', () => {
    expect(parentsByName(build('C: B\nB: OLD1\nD: OLD2'), ['C', 'D'])).toEqual({ C: 'unloaded#0', D: 'unloaded#1' });
  });
});

describe('buildView', () => {
  it('lays out search matches with main in lane 0', () => {
    const graph = build(
      `
M2: M1 F2
F2: F1
M1: B G1
G1: B
F1: B
B: A
A:`,
      { main: 'M2', feature: 'F2', other: 'G1' },
    );
    const result = view(graph, ['M2', 'F1', 'G1', 'A']);
    expect(ascii(graph, result)).toMatchInlineSnapshot(`
      "○─┬─╮  M2
      │ ● │  G1
      │ │ ●  F1
      ●─┴─╯  A
      "
    `);
  });

  it('starts lane 0 at the default branch’s first kept commit', () => {
    const graph = build('M: D F\nF: B\nD: B\nB: A\nA:', { main: 'M', feature: 'F' });
    const result = view(graph, ['F', 'D', 'A']);
    expect(result.lines.mainlineTip).toBe(result.viewOf[graph.row('D')]);
    expect(result.layout.lane[result.viewOf[graph.row('D')]!]).toBe(0);
    expect(result.layout.lane[result.viewOf[graph.row('F')]!]).toBe(1);
  });

  it('keeps ancestry among kept commits exactly, and every layout sound, on random histories', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const input = randomHistory(260, seed);
      const dag = withChildren(input);
      const { lines } = analyzeGraph(input);
      const random = seededRandom(seed * 7);
      const density = 0.05 + random() * 0.6;
      const keep = new Uint8Array(input.count).map(() => (random() < density ? 1 : 0));
      const result = buildView(input, lines, keep);
      expect(checkLayout(result.dag, result.lines, result.layout), `seed ${seed}`).toEqual([]);

      for (let v = 0; v < result.dag.count; v++) {
        const row = result.rows[v]!;
        const full = ancestors(dag, row);
        const shown = ancestors(result.dag, v);
        for (let w = v + 1; w < result.dag.count; w++) {
          expect(shown[w] === 1, `seed ${seed}: ${row} → ${result.rows[w]}`).toBe(full[result.rows[w]!] === 1);
        }
        // The first parent continues the first-parent chain when it has a kept commit.
        let next = firstParent(input, row);
        while (next >= 0 && next < input.count && !keep[next]) next = firstParent(input, next);
        if (next >= 0 && next < input.count) expect(result.rows[firstParent(result.dag, v)]).toBe(next);
        const parents = result.dag.parentIdx.slice(result.dag.parentStart[v], result.dag.parentStart[v + 1]);
        expect(new Set(parents).size, 'no duplicate parents').toBe(parents.length);
      }
    }
  });
});
