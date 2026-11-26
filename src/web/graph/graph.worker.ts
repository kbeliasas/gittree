import { expose, transfer } from 'comlink';

import { analyzeGraph, transferables } from './analyze.ts';
import type { GraphInput } from './dag.ts';

/** Lane layout and branch lines off the main thread (PLAN §5). */
const api = {
  analyze(input: GraphInput) {
    const analysis = analyzeGraph(input);
    return transfer(analysis, transferables(analysis));
  },
};

export type GraphWorkerApi = typeof api;

expose(api);
