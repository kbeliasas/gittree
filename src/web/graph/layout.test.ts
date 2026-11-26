import { describe, expect, it } from 'vitest';

import { analyzeGraph } from './analyze.ts';
import { checkLayout } from './check.ts';
import { build, randomHistory, type Built } from './testing.ts';

const sound = (graph: Built) => {
  expect(checkLayout(graph.input, graph.analysis.lines, graph.analysis.layout)).toEqual([]);
  return graph;
};

describe('computeLayout', () => {
  it('draws a straight line for linear history', () => {
    const graph = sound(build('C: B\nB: A\nA:', { main: 'C' }));
    expect(graph.analysis.layout.width).toBe(1);
    expect(graph.ascii()).toMatchInlineSnapshot(`
      "●  C  (main)
      ●  B
      ●  A
      "
    `);
  });

  it('keeps main in lane 0 with a merged feature branch beside it', () => {
    const graph = sound(
      build(
        `
M: D F2
F2: F1
D: B
F1: B
B: A
A:`,
        { main: 'M', feature: 'F2' },
      ),
    );
    const { lane } = graph.analysis.layout;
    for (const name of ['M', 'D', 'B', 'A']) expect(lane[graph.row(name)], name).toBe(0);
    for (const name of ['F2', 'F1']) expect(lane[graph.row(name)], name).toBe(1);
    expect(graph.ascii()).toMatchInlineSnapshot(`
      "○─╮  M  (main)
      │ ●  F2  (feature)
      ● │  D
      │ ●  F1
      ●─╯  B
      ●    A
      "
    `);
  });

  it('pins main to lane 0 even when a newer branch tip comes first', () => {
    const graph = sound(build('X2: X1\nX1: B\nB: A\nA:', { main: 'B', topic: 'X2' }));
    expect(graph.analysis.layout.lane[graph.row('X2')]).toBe(1);
    expect(graph.analysis.layout.lane[graph.row('B')]).toBe(0);
    expect(graph.ascii()).toMatchInlineSnapshot(`
      "  ●  X2  (topic)
        ●  X1
      ●─╯  B  (main)
      ●    A
      "
    `);
  });

  it('opens a new lane for an octopus merge and closes lanes at the fork point', () => {
    const graph = sound(
      build(
        `
O: B T1 T2 T3
T3: B
T2: B
T1: B
B: A
A:`,
        { main: 'O' },
      ),
    );
    expect(graph.analysis.layout.width).toBe(4);
    expect(graph.ascii()).toMatchInlineSnapshot(`
      "○─┬─┬─╮  O  (main)
      │ │ │ ●  T3
      │ │ ● │  T2
      │ ● │ │  T1
      ●─┴─┴─╯  B
      ●        A
      "
    `);
  });

  it('lays out a criss-cross merge', () => {
    sound(
      build(
        `
M2: M1 B3
M1: R A3
B3: B2
A3: A2
B2: B1 A1
A2: A1 B1
B1: R
A1: R
R: Z
Z:`,
        { main: 'M2' },
      ),
    );
  });

  it("doesn't reuse a lane that ends in a commit for that commit's merge edge", () => {
    // S forks from M; M merges C: S's lane ends in M and C must get a fresh lane.
    const graph = sound(build('S: M\nM: B C\nC: A\nB: A\nA:', { main: 'M', side: 'S' }));
    expect(graph.ascii()).toMatchInlineSnapshot(`
      "  ●    S  (side)
      ○─┴─╮  M  (main)
      │   ●  C
      ●   │  B
      ●───╯  A
      "
    `);
  });

  it('joins a merge edge to the lane already heading for that parent', () => {
    const graph = sound(build('M: D X\nY: X\nD: X\nX: A\nA:', { main: 'M', y: 'Y' }));
    expect(graph.analysis.layout.width).toBeLessThanOrEqual(3);
  });

  it('handles several roots, unloaded parents and duplicate parents', () => {
    sound(build('C: B\nB: A\nA:\nZ:', { main: 'C', other: 'Z' }));
    const unloaded = sound(build('C: B X\nB: OLD', { main: 'C' }));
    // lanes heading for unloaded parents run off the bottom
    expect(unloaded.analysis.layout.width).toBe(2);
    sound(build('C: B B\nB:', { main: 'C' }));
  });

  it('uses lane 0 for whatever comes first when there is no default branch', () => {
    const graph = sound(build('B: A\nA:', { topic: 'B' }, { defaultBranch: null }));
    expect(graph.analysis.lines.mainlineTip).toBe(-1);
    expect([...graph.analysis.layout.lane]).toEqual([0, 0]);
  });

  it('keeps every invariant on random histories', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const input = randomHistory(400, seed);
      const analysis = analyzeGraph(input);
      expect(checkLayout(input, analysis.lines, analysis.layout), `seed ${seed}`).toEqual([]);
    }
  });

  it('lays out 10,000 commits well within the budget', () => {
    const input = randomHistory(10_000, 7);
    analyzeGraph(input); // warm up the JIT
    const started = performance.now();
    const analysis = analyzeGraph(input);
    const elapsed = performance.now() - started;
    expect(checkLayout(input, analysis.lines, analysis.layout)).toEqual([]);
    // PLAN §7 aims for well under 100 ms; the assertion leaves room for slow CI machines.
    expect(elapsed).toBeLessThan(1_000);
    console.info(`layout of 10,000 commits: ${elapsed.toFixed(1)} ms, ${analysis.layout.width} lanes`);
  });
});
