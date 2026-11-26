import type { GraphInput } from './dag.ts';
import { computeLayout, type Layout } from './layout.ts';
import { assignLines, type Lines } from './lines.ts';

export interface GraphAnalysis {
  lines: Lines;
  layout: Layout;
}

/** Everything the worker computes for one graph page. Pure, so tests call it directly. */
export function analyzeGraph(input: GraphInput): GraphAnalysis {
  const lines = assignLines(input);
  return { lines, layout: computeLayout(input, lines) };
}

/** The typed-array buffers in an analysis, to transfer instead of copy. */
export function transferables(analysis: GraphAnalysis): ArrayBuffer[] {
  const { lines, layout } = analysis;
  return [
    lines.owner,
    lines.mainline,
    layout.lane,
    layout.segStart,
    layout.segKind,
    layout.segFrom,
    layout.segTo,
    layout.segChild,
    layout.segChild2,
    layout.segParent,
    layout.segLine,
  ].map((array) => array.buffer as ArrayBuffer);
}
