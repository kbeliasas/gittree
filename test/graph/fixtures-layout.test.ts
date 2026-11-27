import { describe, expect, inject, it } from 'vitest';

import { readGraph, readSnapshot } from '../../src/server/graph/graph.ts';
import { GitRunner } from '../../src/server/git/runner.ts';
import { resolveRepo } from '../../src/server/repos/repo.ts';
import { GRAPH_PAGE_SIZE, type GraphOrder } from '../../src/shared/api.ts';
import { analyzeGraph } from '../../src/web/graph/analyze.ts';
import { renderAscii } from '../../src/web/graph/ascii.ts';
import { checkLayout } from '../../src/web/graph/check.ts';
import { toGraphInput, toModel, type GraphModel } from '../../src/web/graph/model.ts';
import { focusBranch } from '../../src/web/graph/reach.ts';
import type { FixtureName } from '../fixtures/build.ts';

/**
 * PLAN §11: lane-layout invariants plus a readable snapshot per fixture, in
 * both orders. A change in lane assignment shows up as a diff of these files.
 */
const fixtures = inject('fixtures');
const git = new GitRunner();

const NAMES: FixtureName[] = [
  'linear',
  'merges',
  'multiRoot',
  'files',
  'people',
  'branches',
  'detached',
  'shallow',
  'worktreeLinked',
  'submodule',
  'conflicts',
];

async function load(name: FixtureName, order: GraphOrder, limit = GRAPH_PAGE_SIZE): Promise<GraphModel> {
  const repo = await resolveRepo(git, fixtures.repos[name].dir);
  const snapshot = await readSnapshot(git, repo);
  return toModel(await readGraph(git, repo, snapshot, { order, offset: 0, limit }));
}

function ascii(model: GraphModel, analysis: ReturnType<typeof analyzeGraph>): string {
  return renderAscii(
    analysis.layout,
    model.commits.map((commit, row) => ({
      subject: commit.subject,
      refs: (model.refsAt.get(row) ?? []).map((ref) => ref.name),
      merge: commit.parents.length > 1,
      boundary: commit.boundary,
    })),
  );
}

describe('lane layout of every fixture', () => {
  for (const name of NAMES) {
    for (const order of ['date', 'topo'] as const) {
      it(`${name} (${order} order)`, async () => {
        const model = await load(name, order);
        const input = toGraphInput(model);
        const analysis = analyzeGraph(input);
        expect(checkLayout(input, analysis.lines, analysis.layout)).toEqual([]);
        await expect(ascii(model, analysis)).toMatchFileSnapshot(`__snapshots__/${name}.${order}.txt`);
      });
    }
  }

  it('stays sound on a truncated page', async () => {
    const model = await load('merges', 'date', 7);
    expect(model.truncated).toBe(true);
    expect(model.unloaded.length).toBeGreaterThan(0);
    const input = toGraphInput(model);
    const analysis = analyzeGraph(input);
    expect(checkLayout(input, analysis.lines, analysis.layout)).toEqual([]);
  });
});

describe('branch focus on the merges fixture', () => {
  it('finds own commits, fork point and merge', async () => {
    const model = await load('merges', 'date');
    const { lines } = analyzeGraph(toGraphInput(model));
    const { shas } = fixtures.repos.merges;
    const row = (label: string) => model.rowOf.get(shas[label]!)!;
    const tipOf = (ref: string) => model.payload.refs.find((r) => r.name === ref)!.commit;
    const subjects = (mask: Uint8Array) => model.commits.filter((_, r) => mask[r]).map((c) => c.subject);

    const login = focusBranch(model, lines.mainline, lines.mainlineTip, tipOf('feature/SHOP-12-login'));
    expect(subjects(login.own)).toEqual(['SHOP-12 Login API client', 'SHOP-12 Add login form']);
    expect(model.commits[login.fork]?.subject).toBe('Add app shell');
    expect(login.merge).toBe(row('merge-login'));

    const search = focusBranch(model, lines.mainline, lines.mainlineTip, tipOf('feature/SHOP-20-search'));
    expect(subjects(search.own)).toEqual(['SHOP-20 Search results', 'SHOP-20 Search box']);
    expect(search.fork).toBe(row('merge-cart'));
    expect(search.merge).toBe(-1);
  });
});
