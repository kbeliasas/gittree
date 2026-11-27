import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';

import type { GraphRef } from '../../../shared/api.ts';
import { parentCount } from '../../graph/dag.ts';
import { cx } from '../../lib/cx.ts';
import { dateTime, shortAge, shortSha } from '../../lib/format.ts';
import { GraphCell, graphWidth, ROW_HEIGHT } from './GraphCell.tsx';
import { badgesFor, RefBadges, type Badge } from './RefBadges.tsx';
import { isRowLit, useHover, type Emphasis, type LoadedGraph, type ShownGraph } from './state.ts';

interface CommitListProps {
  graph: LoadedGraph;
  /** The rows to list: all commits, or the ones a search kept. Everything else below is in view rows. */
  shown: ShownGraph;
  /** The selected commit's view row, or -1 when it isn't shown. */
  selected: number;
  emphasis: Emphasis | null;
  /** Rows marked at their left edge: the commits a selected merge brought in. */
  marked: Uint8Array | null;
  /** Graph rows the search matches (`data-match`). */
  matched: Uint8Array | null;
  focused: string | null;
  /** Called with the graph row. */
  onSelect(row: number): void;
  onFocusRef(ref: GraphRef): void;
}

/** The virtualized commit list with the graph column (PLAN §7: ~28 px rows, only visible rows drawn). */
export function CommitList({ graph, shown, selected, emphasis, marked, matched, focused, onSelect, onFocusRef }: CommitListProps) {
  const { model, analysis } = graph;
  const { view } = shown;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: view.dag.count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Keep the selection in view: centered when a graph or view (re)loads, minimal scrolling when it moves.
  const shownView = useRef<unknown>(null);
  useLayoutEffect(() => {
    if (selected < 0) return;
    const fresh = shownView.current !== view;
    shownView.current = view;
    virtualizer.scrollToIndex(selected, { align: fresh ? 'center' : 'auto' });
  }, [selected, view, virtualizer]);

  const width = graphWidth(view.layout.width);
  const badges = useMemo(() => {
    const byRow = new Map<number, Badge[]>();
    const { head, defaultBranch } = model.payload;
    for (const [row, refs] of model.refsAt) {
      byRow.set(row, badgesFor(refs, analysis.lines, { headBranch: head.branch, detachedHead: false, defaultBranch }));
    }
    if (head.branch === null && model.headRow >= 0) {
      byRow.set(
        model.headRow,
        badgesFor(model.refsAt.get(model.headRow) ?? [], analysis.lines, { headBranch: null, detachedHead: true, defaultBranch }),
      );
    }
    return byRow;
  }, [model, analysis]);

  const marks = emphasis?.kind === 'rows' ? emphasis.marks : undefined;

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-auto outline-none"
      role="listbox"
      aria-label="Commits"
      data-commit-list
      aria-activedescendant={selected >= 0 ? `commit-${selected}` : undefined}
      aria-setsize={view.dag.count}
      tabIndex={0}
      onPointerLeave={() => useHover.getState().setRow(null)}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <CommitRow
            key={item.key}
            row={item.index}
            top={item.start}
            graph={graph}
            shown={shown}
            width={width}
            selected={item.index === selected}
            emphasis={emphasis}
            marked={marked?.[item.index] === 1}
            matched={matched?.[view.rows[item.index]!] === 1}
            mark={marks?.get(item.index)}
            badges={badges.get(view.rows[item.index]!)}
            focused={focused}
            onSelect={onSelect}
            onFocusRef={onFocusRef}
          />
        ))}
      </div>
    </div>
  );
}

interface CommitRowProps {
  /** View row. */
  row: number;
  top: number;
  graph: LoadedGraph;
  shown: ShownGraph;
  width: number;
  selected: boolean;
  emphasis: Emphasis | null;
  marked: boolean;
  matched: boolean;
  mark: 'fork' | 'merge' | undefined;
  badges: Badge[] | undefined;
  focused: string | null;
  onSelect(row: number): void;
  onFocusRef(ref: GraphRef): void;
}

const CommitRow = memo(function CommitRow(props: CommitRowProps) {
  const { row, top, graph, shown, width, selected, emphasis, marked, matched, mark, badges, focused, onSelect, onFocusRef } = props;
  const { model } = graph;
  const { view, lines } = shown;
  const modelRow = view.rows[row]!;
  const commit = model.commits[modelRow]!;
  const author = model.payload.authors[commit.author];
  const lit = emphasis === null || isRowLit(emphasis, row, lines.owner);
  const style = {
    transform: `translateY(${top}px)`,
    height: ROW_HEIGHT,
    '--row-bg': selected ? 'var(--selected-bg)' : 'var(--page-bg)',
  } as CSSProperties;

  return (
    <div
      role="option"
      id={`commit-${row}`}
      aria-selected={selected}
      aria-posinset={row + 1}
      aria-setsize={view.dag.count}
      data-row={row}
      data-sha={commit.sha}
      data-dim={lit ? undefined : 'true'}
      data-merged={marked ? 'true' : undefined}
      data-match={matched ? 'true' : undefined}
      className={cx(
        'absolute top-0 left-0 flex w-full cursor-default items-center text-sm select-none',
        selected ? 'bg-[var(--selected-bg)]' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/70',
      )}
      style={style}
      onPointerEnter={(event) => useHover.getState().setRow(row, event.altKey)}
      onPointerMove={(event) => useHover.getState().setAlt(event.altKey)}
      onClick={() => onSelect(modelRow)}
    >
      {marked && (
        <span
          aria-hidden="true"
          title="Brought in by the selected merge"
          className="absolute top-1 bottom-1 left-0 w-[3px] rounded-r bg-sky-500 dark:bg-sky-400"
        />
      )}
      <GraphCell
        row={row}
        count={view.dag.count}
        layout={view.layout}
        lines={lines}
        width={width}
        emphasis={emphasis}
        merge={parentCount(model, modelRow) > 1}
        head={modelRow === model.headRow}
        boundary={commit.boundary === true}
        mark={mark}
      />
      <div className={cx('flex min-w-0 flex-1 items-center gap-1.5 pr-3 transition-opacity', !lit && 'opacity-35')}>
        {badges && <RefBadges badges={badges} focused={focused} onFocus={onFocusRef} />}
        <span className="truncate">{commit.subject}</span>
      </div>
      {/* The author and hash columns give way when the list is narrow (a diff is open). */}
      <div className={cx('hidden w-40 shrink-0 truncate pr-3 text-zinc-600 transition-opacity @2xl:block dark:text-zinc-400', !lit && 'opacity-35')}>
        {author?.name}
      </div>
      <div className={cx('hidden w-16 shrink-0 font-mono text-xs text-zinc-500 transition-opacity @lg:block', !lit && 'opacity-35')}>
        {shortSha(commit.sha)}
      </div>
      <div
        className={cx('w-12 shrink-0 pr-3 text-right text-xs text-zinc-500 tabular-nums transition-opacity', !lit && 'opacity-35')}
        title={dateTime(commit.authorTime)}
      >
        {shortAge(commit.authorTime)}
      </div>
    </div>
  );
});
