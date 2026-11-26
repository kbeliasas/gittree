import type { ReactNode } from 'react';

import { SEG_IN, SEG_OUT, type Layout } from '../../graph/layout.ts';
import type { Lines } from '../../graph/lines.ts';
import { isSegmentLit, type Emphasis } from './state.ts';

export const ROW_HEIGHT = 28;
export const LANE_WIDTH = 14;
/** Wider graphs are clipped so the subjects keep their room. */
export const MAX_VISIBLE_LANES = 24;
const PAD = 6;
const MID = ROW_HEIGHT / 2;
const CORNER = 5;
const NODE_RADIUS = 4;
const DIMMED = 0.18;

export function graphWidth(lanes: number): number {
  return PAD * 2 + Math.max(1, Math.min(lanes, MAX_VISIBLE_LANES)) * LANE_WIDTH;
}

const laneX = (lane: number) => PAD + lane * LANE_WIDTH + LANE_WIDTH / 2;

/** One segment as an SVG path: straight lanes, rounded corners where a line turns (PLAN §7). */
export function segmentPath(kind: number, from: number, to: number): string {
  const x1 = laneX(from);
  const x2 = laneX(to);
  if (kind === SEG_IN) {
    if (from === to) return `M${x1} 0V${MID}`;
    const side = Math.sign(x1 - x2);
    return `M${x1} 0V${MID - CORNER}Q${x1} ${MID} ${x1 - side * CORNER} ${MID}H${x2}`;
  }
  if (kind === SEG_OUT) {
    if (from === to) return `M${x1} ${MID}V${ROW_HEIGHT}`;
    const side = Math.sign(x2 - x1);
    return `M${x1} ${MID}H${x2 - side * CORNER}Q${x2} ${MID} ${x2} ${MID + CORNER}V${ROW_HEIGHT}`;
  }
  return `M${x1} 0V${ROW_HEIGHT}`;
}

interface GraphCellProps {
  row: number;
  count: number;
  layout: Layout;
  lines: Lines;
  width: number;
  emphasis: Emphasis | null;
  merge: boolean;
  head: boolean;
  boundary: boolean;
  mark: 'fork' | 'merge' | undefined;
}

/** The graph column of one row: its own segments and its commit's node. */
export function GraphCell({ row, count, layout, lines, width, emphasis, merge, head, boundary, mark }: GraphCellProps) {
  const dim: ReactNode[] = [];
  const lit: ReactNode[] = [];
  for (let s = layout.segStart[row]!; s < layout.segStart[row + 1]!; s++) {
    const on = emphasis === null || isSegmentLit(emphasis, layout, s, count);
    const color = lines.list[layout.segLine[s]!]?.color ?? 0;
    (on ? lit : dim).push(
      <path
        key={s}
        d={segmentPath(layout.segKind[s]!, layout.segFrom[s]!, layout.segTo[s]!)}
        stroke={`var(--lane-${color})`}
        opacity={on ? undefined : DIMMED}
      />,
    );
  }

  const owner = lines.list[lines.owner[row]!];
  const nodeColor = `var(--lane-${owner?.color ?? 0})`;
  const nodeOn = emphasis === null || (emphasis.kind === 'line' ? lines.owner[row] === emphasis.line : emphasis.rows[row] === 1);
  const cx = laneX(layout.lane[row]!);

  return (
    <svg width={width} height={ROW_HEIGHT} className="shrink-0 overflow-hidden" aria-hidden="true">
      <g fill="none" strokeWidth={2}>
        {dim}
        {lit}
      </g>
      <g opacity={nodeOn ? undefined : DIMMED} data-node={row}>
        {boundary && (
          <path d={`M${cx} ${MID + NODE_RADIUS}V${ROW_HEIGHT}`} stroke={nodeColor} strokeWidth={2} strokeDasharray="2 3" />
        )}
        {head && <circle cx={cx} cy={MID} r={NODE_RADIUS + 3.5} fill="none" stroke={nodeColor} strokeWidth={1.5} />}
        {mark && (
          <circle cx={cx} cy={MID} r={NODE_RADIUS + 3.5} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 3" />
        )}
        <circle
          cx={cx}
          cy={MID}
          r={merge ? NODE_RADIUS - 0.5 : NODE_RADIUS}
          fill={merge ? 'var(--row-bg)' : nodeColor}
          stroke={merge ? nodeColor : 'var(--row-bg)'}
          strokeWidth={merge ? 2 : 1.5}
        />
      </g>
    </svg>
  );
}
