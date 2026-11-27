import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

import type { FileDiff } from '../../../shared/api.ts';
import { cx } from '../../lib/cx.ts';
import { numberFormat } from '../../lib/format.ts';
import { highlightInWorker, spansFor, type Highlighted, type TokenStyle } from './highlight.ts';
import type { DiffMode } from './mode.ts';
import { buildCombinedRows, buildRows, EXPAND_STEP, parseDiff, revealMore, type DiffLine, type ParsedDiff, type Reveal, type Row } from './rows.ts';

interface DiffLinesProps {
  diff: FileDiff;
  mode: DiffMode;
  /** Identifies the diff (commit, comparison, path, whitespace) for the highlight cache. */
  cacheKey: readonly unknown[];
  /** Receives the scroll container, so the panel can focus it for keyboard scrolling. */
  scrollRef: RefObject<HTMLDivElement | null>;
}

/** The lines of one file's diff: virtualized, folded around changes, highlighted when the worker is done. */
export function DiffLines({ diff, mode, cacheKey, scrollRef }: DiffLinesProps) {
  if (diff.columns > 1) return <CombinedLines diff={diff} scrollRef={scrollRef} />;
  return <OrdinaryLines diff={diff} mode={mode} cacheKey={cacheKey} scrollRef={scrollRef} />;
}

function OrdinaryLines({ diff, mode, cacheKey, scrollRef }: DiffLinesProps) {
  const parsed = useMemo(() => parseDiff(diff), [diff]);
  const [reveals, setReveals] = useState<ReadonlyMap<number, Reveal>>(new Map());
  const rows = useMemo(() => buildRows(parsed, { mode, fullContext: diff.fullContext, reveals }), [parsed, mode, diff.fullContext, reveals]);
  const highlight = useQuery({
    queryKey: ['highlight', ...cacheKey],
    queryFn: () => highlightInWorker(diff.path, [parsed.oldText, parsed.newText]),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 60_000,
    structuralSharing: false,
    retry: false,
  });
  const styles = useMemo(() => tokenStyles(highlight.data), [highlight.data]);
  const digits = String(Math.max(lastLine(parsed), 1)).length;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 30,
    getItemKey: (index) => rows[index]!.key,
  });

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      aria-label={`Changes in ${diff.path}`}
      data-diff-mode={mode}
      data-highlighted={highlight.data ? highlight.data.lang : undefined}
      className="min-h-0 flex-1 overflow-y-auto font-mono text-xs leading-5 outline-none"
      style={{ '--gutter': `${digits + 1.5}ch` } as CSSProperties}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            <RowView
              row={rows[item.index]!}
              tokens={highlight.data?.lines}
              styles={styles}
              onReveal={(fold, side) => setReveals((current) => revealMore(current, fold, side))}
              onRevealAll={(fold) => setReveals((current) => new Map(current).set(fold, 'all'))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The highest line number shown, for the gutter width. */
function lastLine(parsed: ParsedDiff): number {
  let max = 0;
  for (const hunk of parsed.hunks) for (const line of hunk.lines) max = Math.max(max, line.oldNo ?? 0, line.newNo ?? 0);
  return max;
}

/** Inline styles for each highlighter style: the light and dark colors as variables, switched in CSS. */
function tokenStyles(highlighted: Highlighted | null | undefined): Array<{ style: CSSProperties; className: string }> | undefined {
  return highlighted?.styles.map((style: TokenStyle) => ({
    style: { '--tl': style.light, '--td': style.dark } as CSSProperties,
    className: cx('tok', style.italic && 'italic', style.bold && 'font-semibold'),
  }));
}

interface RowViewProps {
  row: Row;
  tokens: number[][][] | undefined;
  styles: Array<{ style: CSSProperties; className: string }> | undefined;
  onReveal(fold: number, side: 'top' | 'bottom'): void;
  onRevealAll(fold: number): void;
}

const RowView = memo(function RowView({ row, tokens, styles, onReveal, onRevealAll }: RowViewProps) {
  switch (row.kind) {
    case 'hunk':
      return <div className="bg-sky-50 px-2 text-zinc-500 dark:bg-sky-950/40 dark:text-zinc-400">{row.header}</div>;
    case 'fold':
      return (
        <div className="flex items-center gap-1 bg-zinc-50 px-2 font-sans text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400" data-fold>
          {/* Stepwise only when a step doesn't already show everything. */}
          {row.down && row.hidden > EXPAND_STEP && (
            <FoldButton label={`Show ${EXPAND_STEP} more lines below the change above`} onClick={() => onReveal(row.fold, 'top')}>
              ↓ {EXPAND_STEP}
            </FoldButton>
          )}
          {row.up && row.hidden > EXPAND_STEP && (
            <FoldButton label={`Show ${EXPAND_STEP} more lines above the change below`} onClick={() => onReveal(row.fold, 'bottom')}>
              ↑ {EXPAND_STEP}
            </FoldButton>
          )}
          <FoldButton label={`Show all ${row.hidden} unchanged lines`} onClick={() => onRevealAll(row.fold)}>
            ⋯ {numberFormat.format(row.hidden)} unchanged lines
          </FoldButton>
        </div>
      );
    case 'line':
      return (
        <div className={cx('grid grid-cols-[var(--gutter)_var(--gutter)_1.25rem_1fr]', LINE_BG[row.line.kind])} data-line={row.line.kind}>
          <LineNumber value={row.line.oldNo} kind={row.line.kind} />
          <LineNumber value={row.line.newNo} kind={row.line.kind} />
          <Marker kind={row.line.kind} />
          <Code line={row.line} tokens={tokensOf(row.line, tokens, 'auto')} styles={styles} />
        </div>
      );
    case 'pair':
      return (
        <div className="grid grid-cols-2" data-line={row.left === row.right ? 'context' : 'change'}>
          <Half line={row.left} side="old" tokens={tokens} styles={styles} />
          <Half line={row.right} side="new" tokens={tokens} styles={styles} border />
        </div>
      );
  }
});

function Half(props: {
  line: DiffLine | null;
  side: 'old' | 'new';
  tokens: number[][][] | undefined;
  styles: RowViewProps['styles'];
  border?: boolean;
}) {
  const { line, side, tokens, styles, border } = props;
  const frame = cx('grid min-w-0 grid-cols-[var(--gutter)_1.25rem_1fr]', border && 'border-l border-zinc-200 dark:border-zinc-800');
  if (!line) return <div className={cx(frame, 'bg-zinc-50 dark:bg-zinc-900/60')} aria-hidden="true" />;
  const kind = line.kind;
  return (
    <div className={cx(frame, LINE_BG[kind])}>
      <LineNumber value={side === 'old' ? line.oldNo : line.newNo} kind={kind} />
      <Marker kind={kind} />
      <Code line={line} tokens={tokensOf(line, tokens, side)} styles={styles} />
    </div>
  );
}

/** Context lines are the same on both sides; the new side's tokens are used unless the old side is asked for. */
function tokensOf(line: DiffLine, tokens: number[][][] | undefined, side: 'old' | 'new' | 'auto'): number[] | undefined {
  if (!tokens) return undefined;
  const useOld = line.kind === 'del' || (side === 'old' && line.oldIndex !== null);
  return useOld ? tokens[0]?.[line.oldIndex!] : tokens[1]?.[line.newIndex!];
}

const LINE_BG = {
  context: '',
  add: 'bg-emerald-50 dark:bg-emerald-950/40',
  del: 'bg-rose-50 dark:bg-rose-950/40',
} as const;

const WORD_BG = {
  context: '',
  add: 'rounded-sm bg-emerald-200/80 dark:bg-emerald-700/50',
  del: 'rounded-sm bg-rose-200/80 dark:bg-rose-700/50',
} as const;

function LineNumber({ value, kind }: { value: number | null; kind: DiffLine['kind'] }) {
  return (
    <span
      className={cx(
        'pr-2 text-right text-zinc-400 select-none dark:text-zinc-500',
        kind === 'add' && 'bg-emerald-100/70 dark:bg-emerald-950/70',
        kind === 'del' && 'bg-rose-100/70 dark:bg-rose-950/70',
      )}
    >
      {value ?? ''}
    </span>
  );
}

function Marker({ kind }: { kind: DiffLine['kind'] }) {
  return (
    <span className="text-center text-zinc-400 select-none dark:text-zinc-500" aria-hidden="true">
      {kind === 'add' ? '+' : kind === 'del' ? '−' : ''}
    </span>
  );
}

function Code({ line, tokens, styles }: { line: DiffLine; tokens: number[] | undefined; styles: RowViewProps['styles'] }) {
  const spans = spansFor(line.text, styles ? tokens : undefined, line.words);
  return (
    <span className="min-w-0 pr-3 break-all whitespace-pre-wrap">
      {spans.map((span, i) => {
        const look = span.style >= 0 ? styles?.[span.style] : undefined;
        return (
          <span key={i} className={cx(look?.className, span.changed && WORD_BG[line.kind])} style={look?.style}>
            {span.text}
          </span>
        );
      })}
      {line.noEol && (
        <span className="ml-1 text-rose-500 select-none" title="No newline at end of file" aria-label="no newline at end of file">
          ⊘
        </span>
      )}
    </span>
  );
}

function FoldButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} className="rounded px-1.5 hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" onClick={onClick}>
      {children}
    </button>
  );
}

/** Conflict resolutions: one marker column per parent, the result's line numbers. */
function CombinedLines({ diff, scrollRef }: { diff: FileDiff; scrollRef: RefObject<HTMLDivElement | null> }) {
  const rows = useMemo(() => buildCombinedRows(diff), [diff]);
  const digits = String(Math.max(...rows.map((r) => (r.kind === 'line' ? (r.newNo ?? 0) : 0)), 1)).length;
  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      aria-label={`Conflict resolutions in ${diff.path}`}
      className="min-h-0 flex-1 overflow-y-auto font-mono text-xs leading-5 outline-none"
      style={{ '--gutter': `${digits + 1.5}ch`, '--markers': `${diff.columns + 1}ch` } as CSSProperties}
    >
      {rows.map((row) =>
        row.kind === 'hunk' ? (
          <div key={row.key} className="bg-sky-50 px-2 text-zinc-500 dark:bg-sky-950/40 dark:text-zinc-400">
            {row.header}
          </div>
        ) : (
          <div
            key={row.key}
            data-line={row.markers.includes('-') ? 'del' : row.markers.includes('+') ? 'add' : 'context'}
            className={cx(
              'grid grid-cols-[var(--gutter)_var(--markers)_1fr]',
              row.markers.includes('-') && LINE_BG.del,
              !row.markers.includes('-') && row.markers.includes('+') && LINE_BG.add,
            )}
          >
            <LineNumber value={row.newNo} kind="context" />
            <span className="whitespace-pre text-zinc-500 select-none" title="One column per parent: + added, − removed">
              {row.markers}
            </span>
            <span className="min-w-0 pr-3 break-all whitespace-pre-wrap">{row.text}</span>
          </div>
        ),
      )}
    </div>
  );
}

/**
 * Focuses the diff's scroll container when it first appears for a file, so the arrow keys scroll
 * it — unless the commit list has the focus: stepping through commits there must keep working.
 */
export function useFocusOnChange(ref: RefObject<HTMLElement | null>, key: string, enabled: boolean): void {
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || focused.current === key || !ref.current) return;
    focused.current = key;
    if (document.activeElement?.closest('[data-commit-list]')) return;
    ref.current.focus({ preventScroll: true });
  });
}
