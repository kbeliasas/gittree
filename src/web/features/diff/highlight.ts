import { wrap, type Remote } from 'comlink';

import type { HighlightWorkerApi } from './highlight.worker.ts';

/** A token color in the light and the dark theme. */
export interface TokenStyle {
  light: string;
  dark: string;
  italic?: true;
  bold?: true;
}

export interface Highlighted {
  /** Shiki's grammar id. */
  lang: string;
  styles: TokenStyle[];
  /** Per text, per line: [length, style, length, style, …]; the lengths cover the line. */
  lines: number[][][];
}

/** Highlighting a file bigger than this would take longer than it helps. */
export const MAX_HIGHLIGHT_CHARS = 1_000_000;

let worker: Remote<HighlightWorkerApi> | undefined;

/** Highlights texts as the language of `path`, in the shared highlighter worker. Null for plain text. */
export function highlightInWorker(path: string, texts: readonly string[]): Promise<Highlighted | null> {
  if (texts.reduce((sum, text) => sum + text.length, 0) > MAX_HIGHLIGHT_CHARS) return Promise.resolve(null);
  worker ??= wrap<HighlightWorkerApi>(
    new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module', name: 'highlight' }),
  );
  return worker.highlight(path, texts) as Promise<Highlighted | null>;
}

/** One run of text to render: a syntax style (or none) and whether it is a word-level change. */
export interface Span {
  text: string;
  style: number;
  changed: boolean;
}

/**
 * Cuts a line into spans at token boundaries and word-change boundaries.
 * `tokens` is the line's [length, style, …] list (or undefined: plain text).
 */
export function spansFor(text: string, tokens: readonly number[] | undefined, changes: ReadonlyArray<{ start: number; end: number }> = []): Span[] {
  const cuts = new Set<number>([0, text.length]);
  const styleAt: Array<[start: number, style: number]> = [];
  if (tokens) {
    let offset = 0;
    for (let k = 0; k < tokens.length; k += 2) {
      styleAt.push([offset, tokens[k + 1]!]);
      cuts.add(offset);
      offset += tokens[k]!;
    }
  }
  for (const change of changes) {
    cuts.add(Math.min(change.start, text.length));
    cuts.add(Math.min(change.end, text.length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const spans: Span[] = [];
  let tokenIndex = 0;
  for (let p = 0; p < points.length - 1; p++) {
    const start = points[p]!;
    const end = points[p + 1]!;
    if (end <= start) continue;
    while (tokenIndex + 1 < styleAt.length && styleAt[tokenIndex + 1]![0] <= start) tokenIndex++;
    const style = styleAt[tokenIndex]?.[1] ?? -1;
    const changed = changes.some((c) => c.start <= start && end <= c.end);
    const last = spans.at(-1);
    if (last && last.style === style && last.changed === changed) last.text += text.slice(start, end);
    else spans.push({ text: text.slice(start, end), style, changed });
  }
  return spans;
}
