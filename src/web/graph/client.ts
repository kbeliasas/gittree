import { wrap, type Remote } from 'comlink';

import type { GraphAnalysis } from './analyze.ts';
import type { Dag, GraphInput } from './dag.ts';
import type { GraphWorkerApi } from './graph.worker.ts';
import type { GraphView, LineRows } from './view.ts';

let worker: Remote<GraphWorkerApi> | undefined;

function graphWorker(): Remote<GraphWorkerApi> {
  worker ??= wrap<GraphWorkerApi>(new Worker(new URL('./graph.worker.ts', import.meta.url), { type: 'module', name: 'graph' }));
  return worker;
}

/** Runs the lane layout in the shared graph worker. */
export function analyzeInWorker(input: GraphInput): Promise<GraphAnalysis> {
  return graphWorker().analyze(input) as Promise<GraphAnalysis>;
}

/** Lays out the kept rows of a graph in the worker. */
export function viewInWorker(dag: Dag, lines: LineRows, keep: Uint8Array): Promise<GraphView> {
  // Plain copies: the model keeps its own arrays.
  const plainDag: Dag = { count: dag.count, parentStart: dag.parentStart, parentIdx: dag.parentIdx };
  const plainLines: LineRows = { owner: lines.owner, mainline: lines.mainline, mainlineTip: lines.mainlineTip };
  return graphWorker().view(plainDag, plainLines, keep) as Promise<GraphView>;
}
