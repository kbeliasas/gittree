import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { create } from 'zustand';

import type { GraphOrder } from '../../../shared/api.ts';
import type { GraphAnalysis } from '../../graph/analyze.ts';
import { analyzeInWorker, viewInWorker } from '../../graph/client.ts';
import type { Layout } from '../../graph/layout.ts';
import type { Lines } from '../../graph/lines.ts';
import { toGraphInput, toModel, type GraphModel } from '../../graph/model.ts';
import { fullView, type GraphView } from '../../graph/view.ts';
import { graphQuery } from '../../lib/queries.ts';

export interface LoadedGraph {
  model: GraphModel;
  analysis: GraphAnalysis;
}

/**
 * The graph page plus its layout from the worker. While another order loads,
 * the previous graph stays on screen; model and analysis always belong together.
 */
export function useGraph(repoId: string, order: GraphOrder) {
  const graph = useQuery(graphQuery(repoId, order));
  const model = useMemo(() => (graph.data ? toModel(graph.data) : undefined), [graph.data]);
  const loaded = useQuery({
    queryKey: ['graph-analysis', repoId, order, graph.data?.snapshot ?? null],
    queryFn: async (): Promise<LoadedGraph> => ({ model: model!, analysis: await analyzeInWorker(toGraphInput(model!)) }),
    enabled: model !== undefined,
    placeholderData: keepPreviousData,
    structuralSharing: false,
  });
  return {
    data: loaded.data,
    error: graph.error ?? loaded.error,
    switching: loaded.isPlaceholderData,
  };
}

/** What the commit list shows: the whole graph, or only some commits laid out on their own. */
export interface ShownGraph {
  view: GraphView;
  /** The graph's lines with the view's owners and lane 0. */
  lines: Lines;
}

/**
 * The commits to show: all of them (`keep` null), or the kept ones, laid out in
 * the worker. While a new view is computed, the previous one for the same graph
 * stays on screen.
 */
export function useShownGraph(graph: LoadedGraph, keep: Uint8Array | null): ShownGraph & { switching: boolean } {
  const { model, analysis } = graph;
  const full = useMemo(
    (): ShownGraph => ({ view: fullView(model, analysis.lines, analysis.layout), lines: analysis.lines }),
    [model, analysis],
  );
  const kept = useQuery({
    queryKey: ['graph-view', model.payload.snapshot, model.payload.order, keep ? maskKey(keep) : null],
    queryFn: async () => {
      const view = await viewInWorker(model, analysis.lines, keep!);
      return { graph, shown: { view, lines: { ...analysis.lines, ...view.lines } } satisfies ShownGraph };
    },
    enabled: keep !== null,
    placeholderData: keepPreviousData,
    structuralSharing: false,
    gcTime: 60_000,
  });
  if (keep === null) return { ...full, switching: false };
  // A view computed for another graph (the order changed meanwhile) would point at the wrong rows.
  if (!kept.data || kept.data.graph !== graph) return { ...full, switching: true };
  return { ...kept.data.shown, switching: kept.isPlaceholderData };
}

/** A 64-bit hash of a 0/1 mask, for query keys. */
function maskKey(mask: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < mask.length; i++) {
    a = Math.imul(a ^ mask[i]!, 0x01000193);
    b = Math.imul(b ^ (mask[i]! + i), 0x5bd1e995);
  }
  return `${mask.length}:${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

/** A mask over graph rows as a mask over the view's rows. */
export function maskInView(mask: Uint8Array, view: GraphView): Uint8Array {
  if (view.rows.length === mask.length) return mask;
  const result = new Uint8Array(view.rows.length);
  for (let v = 0; v < view.rows.length; v++) result[v] = mask[view.rows[v]!]!;
  return result;
}

/** An emphasis over graph rows as one over the view's rows; a line stays a line. */
export function emphasisInView(emphasis: Emphasis, view: GraphView): Emphasis {
  if (emphasis.kind === 'line' || view.rows.length === view.viewOf.length) return emphasis;
  const marks = new Map<number, 'fork' | 'merge'>();
  for (const [row, mark] of emphasis.marks) if (view.viewOf[row]! >= 0) marks.set(view.viewOf[row]!, mark);
  return { kind: 'rows', rows: maskInView(emphasis.rows, view), marks };
}

/** Pointer hover over the commit list: changes too often to live in the URL. */
interface HoverState {
  /** The hovered row of the commit list (a view row). */
  row: number | null;
  /** Alt (Option) is held: highlight all ancestors instead of the branch line. */
  alt: boolean;
  /** Something in the details panel is hovered that lights up commits, e.g. a merge's merged commits (graph rows). */
  panel: Emphasis | null;
  setRow(row: number | null, alt?: boolean): void;
  setAlt(alt: boolean): void;
  setPanel(panel: Emphasis | null): void;
}

export const useHover = create<HoverState>()((set) => ({
  row: null,
  alt: false,
  panel: null,
  setRow: (row, alt) =>
    set((state) => (state.row === row && (alt === undefined || alt === state.alt) ? state : { row, alt: alt ?? state.alt })),
  setAlt: (alt) => set((state) => (state.alt === alt ? state : { alt })),
  setPanel: (panel) => set((state) => (state.panel === panel ? state : { panel })),
}));

/** What's highlighted; everything else is dimmed. */
export type Emphasis =
  /** Hover: one branch line. */
  | { kind: 'line'; line: number }
  /** Alt+hover (ancestors) or a focused branch: a set of rows and the edges between them. */
  | { kind: 'rows'; rows: Uint8Array; marks: ReadonlyMap<number, 'fork' | 'merge'> };

export function isRowLit(emphasis: Emphasis, row: number, owner: Int32Array): boolean {
  return emphasis.kind === 'line' ? owner[row] === emphasis.line : emphasis.rows[row] === 1;
}

export function isSegmentLit(emphasis: Emphasis, layout: Layout, segment: number, count: number): boolean {
  if (emphasis.kind === 'line') return layout.segLine[segment] === emphasis.line;
  const parent = layout.segParent[segment]!;
  const child = layout.segChild[segment]!;
  const child2 = layout.segChild2[segment]!;
  const { rows } = emphasis;
  return (parent >= count || rows[parent] === 1) && (rows[child] === 1 || (child2 >= 0 && rows[child2] === 1));
}
