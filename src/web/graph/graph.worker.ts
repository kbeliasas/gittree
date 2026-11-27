import { expose, transfer } from 'comlink';

import { analyzeGraph, transferables } from './analyze.ts';
import type { Dag, GraphInput } from './dag.ts';
import { buildView, viewTransferables, type LineRows } from './view.ts';

/** Lane layout and branch lines off the main thread (PLAN §5). */
const api = {
  analyze(input: GraphInput) {
    const analysis = analyzeGraph(input);
    return transfer(analysis, transferables(analysis));
  },
  /** Part of the graph laid out on its own: search matches in hide mode. */
  view(dag: Dag, lines: LineRows, keep: Uint8Array) {
    const view = buildView(dag, lines, keep);
    return transfer(view, viewTransferables(view));
  },
};

export type GraphWorkerApi = typeof api;

expose(api);
