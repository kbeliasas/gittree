import { describe, expect, it } from 'vitest';

import { ancestors, containedIn, descendants, focusBranch, mergedCommits } from './reach.ts';
import { build, type Built } from './testing.ts';

const names = (graph: Built, mask: Uint8Array) => graph.rows.filter((_, row) => mask[row]);

const HISTORY = `
H: M2
M2: M1 S2
U2: U1
U1: M1
S2: S1
M1: B F2
F2: F1
S1: B
F1: B
B: A
A:`;

describe('reachability', () => {
  const graph = build(HISTORY, { main: 'H', merged: 'F2', open: 'U2', stale: 'S2' });

  it('finds ancestors and descendants', () => {
    expect(names(graph, ancestors(graph.dag, graph.row('F2')))).toEqual(['F2', 'F1', 'B', 'A']);
    expect(names(graph, descendants(graph.dag, graph.row('F1')))).toEqual(['H', 'M2', 'U2', 'U1', 'M1', 'F2', 'F1']);
  });

  it('ignores parents that are not loaded', () => {
    const partial = build('C: B\nB: OLDER', { main: 'C' });
    expect(names(partial, ancestors(partial.dag, 0))).toEqual(['C', 'B']);
  });
});

describe('focusBranch', () => {
  const graph = build(HISTORY, { main: 'H', merged: 'F2', open: 'U2', stale: 'S2' });
  const { mainline, mainlineTip } = graph.analysis.lines;
  const focus = (name: string) => focusBranch(graph.dag, mainline, mainlineTip, graph.row(name));

  it('shows what a merge brought in, where the branch started and where it was merged', () => {
    const merged = focus('F2');
    expect(names(graph, merged.own)).toEqual(['F2', 'F1']);
    expect(merged.ownCount).toBe(2);
    expect(graph.rows[merged.fork]).toBe('B');
    expect(graph.rows[merged.merge]).toBe('M1');
  });

  it("shows an unmerged branch's own commits, without a merge", () => {
    const open = focus('U2');
    expect(names(graph, open.own)).toEqual(['U2', 'U1']);
    expect(graph.rows[open.fork]).toBe('M1');
    expect(open.merge).toBe(-1);
  });

  it('has nothing to show for a commit on the default branch', () => {
    expect(focus('M1')).toMatchObject({ ownCount: 0, fork: -1, merge: -1 });
  });
});

describe('mergedCommits', () => {
  const graph = build(HISTORY, { main: 'H', merged: 'F2', open: 'U2', stale: 'S2' });
  // Newer rows are later in time here: row 0 is the newest.
  const time = (row: number) => -row;

  it("lists what a merge brought in and finds the merged branch's oldest commit", () => {
    const merged = mergedCommits(graph.dag, graph.row('M1'), time);
    expect(names(graph, merged.rows)).toEqual(['F2', 'F1']);
    expect(merged).toMatchObject({ count: 2, partial: false });
    expect(graph.rows[merged.oldest]).toBe('F1');
    expect(names(graph, mergedCommits(graph.dag, graph.row('M2'), time).rows)).toEqual(['S2', 'S1']);
  });

  it('covers every extra parent of an octopus merge and stops at shared history', () => {
    const octopus = build('O: M T1 T2\nT2: B\nT1: B\nM: B\nB:', { main: 'O' });
    expect(names(octopus, mergedCommits(octopus.dag, 0, time).rows)).toEqual(['T2', 'T1']);
  });

  it('is empty for ordinary commits and flags merged history that is not loaded', () => {
    expect(mergedCommits(graph.dag, graph.row('F2'), time)).toMatchObject({ count: 0, oldest: -1 });
    const partial = build('M: A X\nX: OLDER\nA:', { main: 'M' });
    expect(mergedCommits(partial.dag, 0, time)).toMatchObject({ count: 1, partial: true });
  });
});

describe('containedIn', () => {
  const graph = build(HISTORY, { main: 'H', merged: 'F2', open: 'U2', stale: 'S2' });
  const refs = graph.input.refs;
  const refNames = (row: string) => containedIn(graph.dag, graph.row(row), refs).map((r) => r.name).sort();

  it('lists the refs whose history contains the commit', () => {
    expect(refNames('F1')).toEqual(['main', 'merged', 'open']);
    expect(refNames('S1')).toEqual(['main', 'stale']);
    expect(refNames('H')).toEqual(['main']);
  });
});
