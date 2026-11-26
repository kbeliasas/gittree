import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import type { GraphOrder, GraphRef } from '../../../shared/api.ts';
import { errorMessage } from '../../components/Screens.tsx';
import { firstParent } from '../../graph/dag.ts';
import { childrenByLine, findRow, type GraphModel } from '../../graph/model.ts';
import { ancestors, focusBranch, type BranchFocus } from '../../graph/reach.ts';
import { cx } from '../../lib/cx.ts';
import { numberFormat, plural, shortSha } from '../../lib/format.ts';
import type { HistorySearch } from '../../router.tsx';
import { CommitList } from './CommitList.tsx';
import { useGraph, useHover, type Emphasis, type LoadedGraph } from './state.ts';
import { SummaryPanel } from './SummaryPanel.tsx';

const route = getRouteApi('/r/$repoId/history');

/** History (home): commit graph and list, summary of the selected commit on the right. */
export function HistoryView() {
  const { repoId } = route.useParams();
  const search = route.useSearch();
  const { data, error, switching } = useGraph(repoId, search.order ?? 'date');

  if (!data) {
    return error ? <Message title="Couldn’t load the history">{errorMessage(error)}</Message> : <Message title="Loading history…" />;
  }
  if (data.model.count === 0) {
    const branch = data.model.payload.head.branch;
    return (
      <Message title="No commits yet">
        {branch ? `HEAD is on ${branch}, which has no commits.` : 'This repository has no commits.'}
      </Message>
    );
  }
  return <History graph={data} search={search} switching={switching} />;
}

function History({ graph, search, switching }: { graph: LoadedGraph; search: HistorySearch; switching: boolean }) {
  const navigate = route.useNavigate();
  const { model, analysis } = graph;
  const order = search.order ?? 'date';

  const fromUrl = search.sel ? findRow(model, search.sel) : -1;
  const selected = fromUrl >= 0 ? fromUrl : Math.max(0, model.headRow);

  const update = useCallback(
    (patch: HistorySearch, replace = false) => {
      void navigate({ search: (previous) => cleanSearch({ ...previous, ...patch }), replace });
    },
    [navigate],
  );
  /** Clicks and jumps add a Back entry; stepping with the keyboard replaces it. */
  const select = useCallback(
    (row: number, replace = false) => {
      const sha = model.commits[row]?.sha;
      if (sha) update({ sel: sha }, replace);
    },
    [model, update],
  );

  const focusRef = search.focus ? model.payload.refs.find((r) => r.name === search.focus && r.kind !== 'tag') : undefined;
  const focus = useMemo(
    () =>
      focusRef
        ? focusBranch(model, analysis.lines.mainline, analysis.lines.mainlineTip, focusRef.commit - model.payload.page.offset)
        : null,
    [focusRef, model, analysis],
  );
  const toggleFocus = useCallback(
    (ref: GraphRef) => {
      if (search.focus === ref.name) update({ focus: undefined });
      else update({ focus: ref.name, sel: model.commits[ref.commit - model.payload.page.offset]?.sha });
    },
    [search.focus, model, update],
  );

  const hoverRow = useHover((state) => state.row);
  const alt = useHover((state) => state.alt);
  useEffect(() => useHover.getState().setRow(null), [model]);
  const emphasis = useMemo((): Emphasis | null => {
    if (focus) return focusEmphasis(focus);
    if (hoverRow === null || hoverRow >= model.count) return null;
    if (alt) return { kind: 'rows', rows: ancestors(model, hoverRow), marks: new Map() };
    return { kind: 'line', line: analysis.lines.owner[hoverRow]! };
  }, [focus, hoverRow, alt, model, analysis]);

  useHistoryKeys({
    model,
    lane: analysis.layout.lane,
    selected,
    select,
    clearFocus: search.focus ? () => update({ focus: undefined }) : null,
  });

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col" aria-label="History">
        <Toolbar
          model={model}
          order={order}
          onOrder={(next) => update({ order: next === 'date' ? undefined : next })}
          focusName={search.focus ?? null}
          focus={focus}
          onClearFocus={() => update({ focus: undefined })}
          onSelect={select}
          switching={switching}
        />
        <CommitList
          graph={graph}
          selected={selected}
          emphasis={emphasis}
          focused={focusRef?.name ?? null}
          onSelect={select}
          onFocusRef={toggleFocus}
        />
      </section>
      <SummaryPanel graph={graph} row={selected} onSelect={select} />
    </div>
  );
}

function focusEmphasis(focus: BranchFocus): Emphasis {
  const rows = focus.own.slice();
  const marks = new Map<number, 'fork' | 'merge'>();
  if (focus.fork >= 0) {
    rows[focus.fork] = 1;
    marks.set(focus.fork, 'fork');
  }
  if (focus.merge >= 0) {
    rows[focus.merge] = 1;
    marks.set(focus.merge, 'merge');
  }
  return { kind: 'rows', rows, marks };
}

function cleanSearch(search: HistorySearch): HistorySearch {
  const clean: HistorySearch = {};
  if (search.sel) clean.sel = search.sel;
  if (search.order === 'topo') clean.order = 'topo';
  if (search.focus) clean.focus = search.focus;
  return clean;
}

const PAGE_ROWS = 20;

/** PLAN §7 keys: ↑/↓ or j/k move, [ / ] parent / child, Esc clears the focus. Alt shows ancestors on hover. */
function useHistoryKeys(options: {
  model: GraphModel;
  lane: Int32Array;
  selected: number;
  select(row: number, replace?: boolean): void;
  clearFocus: (() => void) | null;
}) {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        useHover.getState().setAlt(true);
        return;
      }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const { model, lane, selected, select, clearFocus } = latest.current;
      const last = model.count - 1;
      switch (event.key) {
        case 'ArrowDown':
        case 'j':
          select(Math.min(last, selected + 1), true);
          break;
        case 'ArrowUp':
        case 'k':
          select(Math.max(0, selected - 1), true);
          break;
        case 'PageDown':
          select(Math.min(last, selected + PAGE_ROWS), true);
          break;
        case 'PageUp':
          select(Math.max(0, selected - PAGE_ROWS), true);
          break;
        case 'Home':
          select(0, true);
          break;
        case 'End':
          select(last, true);
          break;
        case '[': {
          const parent = firstParent(model, selected);
          if (parent < 0 || parent >= model.count) return;
          select(parent);
          break;
        }
        case ']': {
          const child = childrenByLine(model, lane, selected)[0];
          if (child === undefined) return;
          select(child);
          break;
        }
        case 'Escape':
          if (!clearFocus) return;
          clearFocus();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') useHover.getState().setAlt(false);
    };
    const onBlur = () => useHover.getState().setAlt(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

interface ToolbarProps {
  model: GraphModel;
  order: GraphOrder;
  onOrder(order: GraphOrder): void;
  focusName: string | null;
  focus: BranchFocus | null;
  onClearFocus(): void;
  onSelect(row: number): void;
  switching: boolean;
}

function Toolbar({ model, order, onOrder, focusName, focus, onClearFocus, onSelect, switching }: ToolbarProps) {
  const { total } = model.payload.page;
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-zinc-200 px-3 text-xs dark:border-zinc-800">
      <span className="text-zinc-500 dark:text-zinc-400">Order</span>
      <div role="group" aria-label="Graph order" className="flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
        {(['date', 'topo'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={order === value}
            title={value === 'date' ? 'Newest first: what happened when' : "Each branch's commits kept together, fewer crossings"}
            className={cx(
              'px-2 py-0.5',
              order === value ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
            )}
            onClick={() => onOrder(value)}
          >
            {value === 'date' ? 'Date' : 'Topo'}
          </button>
        ))}
      </div>

      {focusName && (
        <div role="status" className="flex min-w-0 items-center gap-1.5 rounded-full bg-zinc-100 py-0.5 pr-1 pl-2.5 dark:bg-zinc-800">
          <span className="truncate">
            Focus: <strong className="font-semibold">{focusName}</strong>
            {focus ? (
              <>
                {' · '}
                {focus.ownCount === 0 ? 'no commits of its own' : plural(focus.ownCount, 'own commit')}
                {focus.fork >= 0 && (
                  <>
                    {' · forked from '}
                    <CommitButton model={model} row={focus.fork} onSelect={onSelect} />
                  </>
                )}
                {focus.merge >= 0 ? (
                  <>
                    {' · merged in '}
                    <CommitButton model={model} row={focus.merge} onSelect={onSelect} />
                  </>
                ) : (
                  focus.ownCount > 0 && ' · not merged'
                )}
              </>
            ) : (
              ' · not in the loaded history'
            )}
          </span>
          <button
            type="button"
            aria-label="Clear focus"
            title="Clear focus (Esc)"
            className="rounded-full px-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            onClick={onClearFocus}
          >
            ✕
          </button>
        </div>
      )}

      <span className="ml-auto shrink-0 text-zinc-500 dark:text-zinc-400">
        {switching ? (
          'Loading…'
        ) : model.truncated ? (
          <span className="text-amber-700 dark:text-amber-400" title="Older commits aren't loaded; this version shows the newest commits only.">
            Showing the newest {numberFormat.format(model.count)} of {plural(total, 'commit')}
          </span>
        ) : (
          plural(model.count, 'commit')
        )}
      </span>
    </div>
  );
}

function CommitButton({ model, row, onSelect }: { model: GraphModel; row: number; onSelect(row: number): void }) {
  return (
    <button
      type="button"
      className="font-mono text-sky-700 hover:underline dark:text-sky-300"
      title={model.commits[row]?.subject}
      onClick={() => onSelect(row)}
    >
      {shortSha(model.commits[row]!.sha)}
    </button>
  );
}

function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="max-w-md text-center">
        <h2 className="font-semibold">{title}</h2>
        {children && <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{children}</p>}
      </div>
    </div>
  );
}
