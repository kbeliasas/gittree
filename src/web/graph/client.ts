import { wrap, type Remote } from 'comlink';

import type { GraphAnalysis } from './analyze.ts';
import type { GraphInput } from './dag.ts';
import type { GraphWorkerApi } from './graph.worker.ts';

let worker: Remote<GraphWorkerApi> | undefined;

/** Runs the lane layout in the shared graph worker. */
export function analyzeInWorker(input: GraphInput): Promise<GraphAnalysis> {
  worker ??= wrap<GraphWorkerApi>(new Worker(new URL('./graph.worker.ts', import.meta.url), { type: 'module', name: 'graph' }));
  return worker.analyze(input) as Promise<GraphAnalysis>;
}
