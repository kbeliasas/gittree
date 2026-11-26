import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { create } from 'zustand';

import type { GraphOrder } from '../../../shared/api.ts';
import type { GraphAnalysis } from '../../graph/analyze.ts';
import { analyzeInWorker } from '../../graph/client.ts';
import type { Layout } from '../../graph/layout.ts';
import { toGraphInput, toModel, type GraphModel } from '../../graph/model.ts';
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

/** Pointer hover over the commit list: changes too often to live in the URL. */
interface HoverState {
  row: number | null;
  /** Alt (Option) is held: highlight all ancestors instead of the branch line. */
  alt: boolean;
  setRow(row: number | null, alt?: boolean): void;
  setAlt(alt: boolean): void;
}

export const useHover = create<HoverState>()((set) => ({
  row: null,
  alt: false,
  setRow: (row, alt) =>
    set((state) => (state.row === row && (alt === undefined || alt === state.alt) ? state : { row, alt: alt ?? state.alt })),
  setAlt: (alt) => set((state) => (state.alt === alt ? state : { alt })),
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
