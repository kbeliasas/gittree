import { SEG_IN, SEG_OUT, SEG_PASS, type Layout } from './layout.ts';

const UP = 1;
const DOWN = 2;
const LEFT = 4;
const RIGHT = 8;

const GLYPHS: Record<number, string> = {
  0: ' ',
  [UP]: '╵',
  [DOWN]: '╷',
  [LEFT]: '╴',
  [RIGHT]: '╶',
  [UP | DOWN]: '│',
  [LEFT | RIGHT]: '─',
  [UP | LEFT]: '╯',
  [UP | RIGHT]: '╰',
  [DOWN | LEFT]: '╮',
  [DOWN | RIGHT]: '╭',
  [UP | DOWN | LEFT]: '┤',
  [UP | DOWN | RIGHT]: '├',
  [DOWN | LEFT | RIGHT]: '┬',
  [UP | LEFT | RIGHT]: '┴',
  [UP | DOWN | LEFT | RIGHT]: '┼',
};

export interface AsciiRow {
  subject: string;
  refs?: readonly string[];
  merge?: boolean;
  boundary?: boolean;
}

/**
 * Draws a layout as text, one line per commit, with the same rounded corners
 * the SVG renderer uses. For snapshot tests and debugging: a lane-assignment
 * change shows up as a readable diff.
 */
export function renderAscii(layout: Layout, rows: readonly AsciiRow[]): string {
  const columns = Math.max(1, layout.width * 2 - 1);
  const out: string[] = [];

  rows.forEach((row, r) => {
    const cells = new Array<number>(columns).fill(0);
    const horizontal = (a: number, b: number) => {
      const lo = Math.min(a, b) * 2;
      const hi = Math.max(a, b) * 2;
      for (let c = lo; c <= hi; c++) {
        if (c > lo) cells[c] = cells[c]! | LEFT;
        if (c < hi) cells[c] = cells[c]! | RIGHT;
      }
    };

    for (let s = layout.segStart[r]!; s < layout.segStart[r + 1]!; s++) {
      const from = layout.segFrom[s]!;
      const to = layout.segTo[s]!;
      switch (layout.segKind[s]) {
        case SEG_PASS:
          cells[from * 2] = cells[from * 2]! | UP | DOWN;
          break;
        case SEG_IN:
          cells[from * 2] = cells[from * 2]! | UP;
          horizontal(from, to);
          break;
        case SEG_OUT:
          cells[to * 2] = cells[to * 2]! | DOWN;
          horizontal(from, to);
          break;
      }
    }

    const glyphs = cells.map((bits) => GLYPHS[bits] ?? '?');
    glyphs[layout.lane[r]! * 2] = row.merge ? '○' : '●';
    const graph = glyphs.join('').padEnd(columns);
    const refs = row.refs && row.refs.length > 0 ? `  (${row.refs.join(', ')})` : '';
    const boundary = row.boundary ? '  [shallow boundary]' : '';
    out.push(`${graph}  ${row.subject}${refs}${boundary}`.trimEnd());
  });
  return `${out.join('\n')}\n`;
}
