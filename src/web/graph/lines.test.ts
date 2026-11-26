import { describe, expect, it } from 'vitest';

import { DEFAULT_COLOR } from './colors.ts';
import { parseMergeSources } from './lines.ts';
import { build, type Built } from './testing.ts';

const lineOf = (graph: Built, commit: string) => graph.analysis.lines.list[graph.analysis.lines.owner[graph.row(commit)]!]!;

describe('assignLines', () => {
  it('gives the default branch its own color and the first claim on history', () => {
    const graph = build('M: D F\nF: B\nD: B\nB: A\nA:', { main: 'M', feature: 'F' });
    expect(lineOf(graph, 'A')).toMatchObject({ name: 'main', kind: 'default', color: DEFAULT_COLOR });
    expect(lineOf(graph, 'F')).toMatchObject({ name: 'feature', kind: 'local' });
    expect(lineOf(graph, 'F').color).not.toBe(DEFAULT_COLOR);
  });

  it('starts lane 0 at origin/main when it is ahead of main, and shares one line', () => {
    const graph = build('N2: N1\nN1: B\nB: A\nA:', {
      main: { at: 'B', upstream: 'origin/main' },
      'origin/main': 'N2',
    });
    const { lines } = graph.analysis;
    expect(lines.mainlineTip).toBe(graph.row('N2'));
    expect(lineOf(graph, 'N2')).toBe(lineOf(graph, 'A'));
    expect(lines.byRef.get('origin/main')).toBe(lines.byRef.get('main'));
    expect([...graph.analysis.layout.lane]).toEqual([0, 0, 0, 0]);
  });

  it('keeps lane 0 on local main when it diverged from origin/main', () => {
    const graph = build('L: B\nR: B\nB: A\nA:', { main: { at: 'L', upstream: 'origin/main' }, 'origin/main': 'R' });
    expect(graph.analysis.lines.mainlineTip).toBe(graph.row('L'));
    expect(graph.analysis.layout.lane[graph.row('R')]).toBe(1);
    expect(lineOf(graph, 'R').kind).toBe('default'); // same color, off lane 0
  });

  it("puts HEAD's branch first and a branch contained in another on the other's line", () => {
    const graph = build('B2: B1\nB1: A1\nA1: R\nR:', { main: 'R', b: 'B2', a: 'A1' }, { head: 'A1', headBranch: 'a' });
    expect(lineOf(graph, 'A1').name).toBe('a');
    expect(lineOf(graph, 'B1').name).toBe('b');

    const newestFirst = build('B2: B1\nB1: A1\nA1: R\nR:', { main: 'R', b: 'B2', a: 'A1' });
    expect(lineOf(newestFirst, 'A1').name).toBe('b');
  });

  it('groups a branch with the remote branch it tracks, and names lines of deleted branches from merges', () => {
    const graph = build(
      'M: D X2\nX2: X1\nD: P\nP: B\nX1: B\nB: A\nA:',
      { main: 'M', topic: { at: 'P', upstream: 'origin/topic' }, 'origin/topic': 'P', 'origin/solo': 'D' },
      { subjects: { M: "Merge pull request #42 from someone/feature/x" } },
    );
    const { lines } = graph.analysis;
    expect(lines.byRef.get('origin/topic')).toBe(lines.byRef.get('topic'));
    expect(lineOf(graph, 'X1')).toMatchObject({ name: 'feature/x', kind: 'merged', mergedBy: graph.row('M') });
    expect(lines.list[lines.byRef.get('origin/solo')!]?.kind).toBe('remote');
  });

  it('gives a detached HEAD and a lone tag their own lines', () => {
    const graph = build('H: A\nT: A\nA:', { main: 'A', v1: { at: 'T', kind: 'tag' } }, { head: 'H' });
    expect(lineOf(graph, 'H')).toMatchObject({ name: 'HEAD', kind: 'head' });
    expect(lineOf(graph, 'T')).toMatchObject({ name: 'v1', kind: 'tag' });
  });

  it('owns every row', () => {
    const graph = build('M: C B\nC: A\nB: A\nA:\nZ:', { main: 'M' });
    expect([...graph.analysis.lines.owner].every((line) => line >= 0)).toBe(true);
  });
});

describe('parseMergeSources', () => {
  it.each([
    ["Merge branch 'feature/login'", ['feature/login']],
    ["Merge branch 'feature/login' into develop", ['feature/login']],
    ["Merge branch 'fix' into 'main'", ['fix']],
    ["Merge branch 'x' of github.com:org/repo", ['x']],
    ["Merge branches 'a', 'b' and 'c'", ['a', 'b', 'c']],
    ["Merge remote-tracking branch 'origin/hotfix'", ['origin/hotfix']],
    ['Merge pull request #12 from alice/feature/cart', ['feature/cart']],
    ['Merged in bugfix/null-check (pull request #7)', ['bugfix/null-check']],
    ["Merge tag 'v1.2.0'", ['v1.2.0']],
    ['Merge topics docs, ci and lint', []],
    ['Add login form', []],
  ])('%s', (subject, names) => {
    expect(parseMergeSources(subject)).toEqual(names);
  });
});
