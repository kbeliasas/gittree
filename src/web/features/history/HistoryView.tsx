import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { ChangedFile, CompareWith, GraphOrder, GraphRef } from '../../../shared/api.ts';
import { errorMessage } from '../../components/Screens.tsx';
import { firstParent, parentCount } from '../../graph/dag.ts';
import { childrenByLine, findRow, type GraphModel } from '../../graph/model.ts';
import { ancestors, focusBranch, mergedCommits, type BranchFocus } from '../../graph/reach.ts';
import type { GraphView } from '../../graph/view.ts';
import { cx } from '../../lib/cx.ts';
import { numberFormat, plural, shortSha } from '../../lib/format.ts';
import { commitQuery, settingsQuery } from '../../lib/queries.ts';
import { toggleJira, type QueryMatch, type Term } from '../../lib/query.ts';
import type { HistorySearch } from '../../lib/search.ts';
import { DetailsPanel } from '../details/DetailsPanel.tsx';
import { DiffPanel } from '../diff/DiffPanel.tsx';
import { SearchBar } from '../search/SearchBar.tsx';
import { TicketList } from '../search/TicketList.tsx';
import { nextMatch, useSearch } from '../search/useSearch.ts';
import { CommitList } from './CommitList.tsx';
import { emphasisInView, maskInView, useGraph, useHover, useShownGraph, type Emphasis, type LoadedGraph } from './state.ts';

const route = getRouteApi('/r/$repoId/history');

/** History (home): commit graph and list; details of the selected commit, or a file's diff, on the right. */
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
  return <History repoId={repoId} graph={data} search={search} switching={switching} />;
}

/** Whether a commit can be compared with `compare`: that parent exists, or it is a merge for `cc`. */
function supports(model: GraphModel, row: number, compare: CompareWith): boolean {
  const parents = parentCount(model, row);
  return compare === 'cc' ? parents >= 2 : compare <= Math.max(1, parents);
}

function History(props: { repoId: string; graph: LoadedGraph; search: HistorySearch; switching: boolean }) {
  const { repoId, graph, search, switching } = props;
  const navigate = route.useNavigate();
  const { model, analysis } = graph;
  const order = search.order ?? 'date';
  const query = search.q ?? '';

  // PLAN §8: matches dim the rest, or the rest is hidden and the matches are laid out on their own.
  const [wantBodies, setWantBodies] = useState(false);
  const found = useSearch(repoId, graph, query, wantBodies);
  const hide = search.matches === 'hide' && found.match !== null;
  const shown = useShownGraph(graph, hide ? found.match!.rows : null);
  const { view } = shown;
  const jiraBase = useQuery(settingsQuery()).data?.jira.baseUrl ?? null;
  const searchInput = useRef<HTMLInputElement>(null);

  const fromUrl = search.sel ? findRow(model, search.sel) : -1;
  const selected = fromUrl >= 0 ? fromUrl : Math.max(0, model.headRow);
  const selectedSha = model.commits[selected]!.sha;
  const compare: CompareWith = search.parent !== undefined && supports(model, selected, search.parent) ? search.parent : 1;
  const details = useQuery(commitQuery(repoId, selectedSha, compare));
  const files: readonly ChangedFile[] | null = (details.data?.sha === selectedSha && details.data.compare?.files) || null;

  const update = useCallback(
    (patch: HistorySearch, replace = false) => {
      void navigate({ search: (previous) => cleanSearch({ ...previous, ...patch }), replace });
    },
    [navigate],
  );
  /**
   * Clicks and jumps add a Back entry; stepping with the keyboard replaces it. An open diff stays
   * open, and the comparison carries over when the next commit has that parent too.
   */
  const selection = useCallback(
    (row: number): HistorySearch => ({
      sel: model.commits[row]?.sha,
      parent: search.parent !== undefined && supports(model, row, search.parent) ? search.parent : undefined,
    }),
    [model, search.parent],
  );
  const select = useCallback(
    (row: number, replace = false) => {
      if (model.commits[row]) update(selection(row), replace);
    },
    [model, update, selection],
  );
  const openFile = useCallback((path: string, replace = false) => update({ file: path }, replace), [update]);
  const closeDiff = useCallback(() => update({ file: undefined }), [update]);
  // Enter right after selecting a commit shouldn't be lost while its file list loads.
  const queryClient = useQueryClient();
  const current = useRef(selectedSha);
  current.current = selectedSha;
  const openFirstFile = useCallback(async () => {
    const sha = selectedSha;
    const data = await queryClient.fetchQuery(commitQuery(repoId, sha, compare)).catch(() => null);
    const first = data?.compare?.files[0];
    if (first && current.current === sha) openFile(first.path);
  }, [queryClient, repoId, selectedSha, compare, openFile]);
  const setCompare = useCallback((value: CompareWith) => update({ parent: value === 1 ? undefined : value }), [update]);

  const merged = useMemo(
    () => (parentCount(model, selected) > 1 ? mergedCommits(model, selected, (row) => model.commits[row]!.authorTime) : null),
    [model, selected],
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
  const panelEmphasis = useHover((state) => state.panel);
  useEffect(() => useHover.getState().setRow(null), [view]);
  // Search and focus stay put while the pointer moves; hovering only lights up lines when neither is on.
  const dimmed = !hide && found.match ? found.match.rows : null;
  const steady = useMemo((): Emphasis | null => {
    if (panelEmphasis) return emphasisInView(panelEmphasis, view);
    if (focus) {
      const own = focusEmphasis(focus);
      return emphasisInView(dimmed ? { ...own, rows: own.rows.map((lit, row) => lit & dimmed[row]!) } : own, view);
    }
    return dimmed ? { kind: 'rows', rows: dimmed, marks: new Map() } : null;
  }, [panelEmphasis, focus, dimmed, view]);
  const hovered = useMemo((): Emphasis | null => {
    if (steady || hoverRow === null || hoverRow >= view.dag.count) return null;
    if (alt) return { kind: 'rows', rows: ancestors(view.dag, hoverRow), marks: new Map() };
    return { kind: 'line', line: shown.lines.owner[hoverRow]! };
  }, [steady, hoverRow, alt, view, shown.lines]);
  const emphasis = steady ?? hovered;

  const stepMatch = useCallback(
    (direction: 1 | -1) => {
      const row = found.match ? nextMatch(found.match.rows, selected, direction) : -1;
      if (row >= 0) select(row, true);
    },
    [found.match, selected, select],
  );
  const setQuery = useCallback((q: string, history: 'push' | 'replace') => update({ q: q || undefined }, history === 'replace'), [update]);
  /** Enter in the search bar: the first match (unless the selection is one), then the commit list. */
  const goToResults = useCallback(
    (q: string, history: 'push' | 'replace' | null) => {
      const match = found.matchFor(q);
      let patch: HistorySearch = history === null ? {} : { q: q || undefined };
      let replace = history === 'replace';
      if (match && match.count > 0 && !match.rows[selected]) {
        patch = { ...patch, ...selection(nextMatch(match.rows, -1, 1)) };
        replace = false;
      }
      if (Object.keys(patch).length > 0) update(patch, replace);
      focusCommitList();
    },
    [found, selected, selection, update],
  );

  const diffOpen = search.file !== undefined;
  useHistoryKeys({
    view,
    selected,
    select,
    clearFocus: search.focus ? () => update({ focus: undefined }) : null,
    files,
    file: search.file ?? null,
    openFile,
    openFirstFile,
    closeDiff,
    stepMatch: found.match ? stepMatch : null,
    focusSearch: () => searchInput.current?.focus(),
  });
  const viewSelected = view.viewOf[selected] ?? -1;

  return (
    <div className="flex min-h-0 flex-1">
      <section
        className={cx('@container flex min-w-0 flex-col', diffOpen ? 'w-[clamp(18rem,30%,30rem)] shrink-0' : 'flex-1')}
        aria-label="History"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
          <SearchBar
            value={query}
            onChange={setQuery}
            suggestions={found.suggestions}
            onActivate={() => setWantBodies(true)}
            onSubmit={goToResults}
            onLeave={focusCommitList}
            inputRef={searchInput}
          />
          <MatchCount terms={found.terms} match={found.match} loading={found.loadingBodies} bodiesFailed={found.bodiesError} onStep={stepMatch} />
          <TicketList
            tickets={found.tickets}
            terms={found.terms}
            jiraBase={jiraBase}
            loading={found.loadingBodies}
            onToggle={(key) => update({ q: toggleJira(query, key) || undefined })}
            onOpen={() => setWantBodies(true)}
          />
        </div>
        <Toolbar
          model={model}
          order={order}
          onOrder={(next) => update({ order: next === 'date' ? undefined : next })}
          matches={query === '' ? null : search.matches === 'hide' ? 'hide' : 'dim'}
          onMatches={(next) => update({ matches: next === 'hide' ? 'hide' : undefined })}
          focusName={search.focus ?? null}
          focus={focus}
          onClearFocus={() => update({ focus: undefined })}
          onSelect={select}
          switching={switching || shown.switching}
        />
        {hide && view.dag.count === 0 && !shown.switching ? (
          <Message title="No commits match">Change the search, or show all commits with Matches: Dim.</Message>
        ) : (
          <CommitList
            graph={graph}
            shown={shown}
            selected={viewSelected}
            emphasis={emphasis}
            marked={merged && merged.count > 0 ? maskInView(merged.rows, view) : null}
            matched={found.match?.rows ?? null}
            focused={focusRef?.name ?? null}
            onSelect={select}
            onFocusRef={toggleFocus}
          />
        )}
      </section>
      {diffOpen ? (
        <DiffPanel
          repoId={repoId}
          graph={graph}
          row={selected}
          compare={compare}
          details={details}
          path={search.file!}
          ignoreWhitespace={search.ws === true}
          onClose={closeDiff}
          onOpenFile={openFile}
          onCompare={setCompare}
          onIgnoreWhitespace={(ignore) => update({ ws: ignore ? true : undefined }, true)}
        />
      ) : (
        <DetailsPanel
          repoId={repoId}
          graph={graph}
          row={selected}
          compare={compare}
          details={details}
          merged={merged}
          onSelect={select}
          onFocusRef={toggleFocus}
          onCompare={setCompare}
          onOpenFile={openFile}
        />
      )}
    </div>
  );
}

function focusEmphasis(focus: BranchFocus): Extract<Emphasis, { kind: 'rows' }> {
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
  if (search.parent !== undefined) clean.parent = search.parent;
  if (search.file) clean.file = search.file;
  if (search.ws) clean.ws = true;
  if (search.q) clean.q = search.q;
  if (search.matches === 'hide') clean.matches = 'hide';
  return clean;
}

function focusCommitList() {
  requestAnimationFrame(() => (document.querySelector('[data-commit-list]') as HTMLElement | null)?.focus({ preventScroll: true }));
}

const PAGE_ROWS = 20;

/**
 * PLAN §7 keys: ↑/↓ or j/k move, [ / ] parent / child, Enter opens the first file's diff, Esc
 * closes the diff or clears the focus. Alt shows ancestors on hover. With a diff open, j/k step
 * through the files, and the arrow keys scroll the diff unless the commit list has the focus.
 * PLAN §8: / goes to the search bar, n / N to the next / previous match. Moves stay within the
 * commits shown; from a hidden selection they start where it would be.
 */
function useHistoryKeys(options: {
  view: GraphView;
  /** The selected graph row. */
  selected: number;
  select(row: number, replace?: boolean): void;
  clearFocus: (() => void) | null;
  /** The selected commit's changed files, once loaded. */
  files: readonly ChangedFile[] | null;
  /** The file whose diff is open. */
  file: string | null;
  openFile(path: string, replace?: boolean): void;
  /** Opens the selected commit's first file, waiting for the file list if needed. */
  openFirstFile(): Promise<void>;
  closeDiff(): void;
  /** Steps through search matches; null without a search. */
  stepMatch: ((direction: 1 | -1) => void) | null;
  focusSearch(): void;
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
      const { view, selected, select, clearFocus, files, file, openFile, openFirstFile, closeDiff, stepMatch, focusSearch } = latest.current;
      const count = view.dag.count;
      const at = view.viewOf[selected] ?? -1;
      const inList = event.target instanceof Element && event.target.closest('[data-commit-list]') !== null;
      const diffKeys = file !== null && !inList;
      /** The commit `delta` rows away from the selection in the list. */
      const move = (delta: number) => {
        if (count === 0) return;
        const base = at >= 0 ? at : firstShownAfter(view, selected) - (delta > 0 ? 1 : 0);
        select(view.rows[Math.max(0, Math.min(count - 1, base + delta))]!, true);
      };

      if (file !== null && (event.key === 'j' || event.key === 'k')) {
        const index = files?.findIndex((f) => f.path === file) ?? -1;
        const next = files?.[index + (event.key === 'j' ? 1 : -1)];
        if (next) openFile(next.path, true);
        event.preventDefault();
        return;
      }
      switch (event.key) {
        case 'ArrowDown':
        case 'j':
          if (diffKeys) return; // scroll the diff
          move(1);
          break;
        case 'ArrowUp':
        case 'k':
          if (diffKeys) return;
          move(-1);
          break;
        case 'PageDown':
          if (diffKeys) return;
          move(PAGE_ROWS);
          break;
        case 'PageUp':
          if (diffKeys) return;
          move(-PAGE_ROWS);
          break;
        case 'Home':
          if (diffKeys || count === 0) return;
          select(view.rows[0]!, true);
          break;
        case 'End':
          if (diffKeys || count === 0) return;
          select(view.rows[count - 1]!, true);
          break;
        case '[': {
          const parent = at >= 0 ? firstParent(view.dag, at) : -1;
          if (parent < 0 || parent >= count) return;
          select(view.rows[parent]!);
          break;
        }
        case ']': {
          const child = at >= 0 ? childrenByLine(view.dag, view.layout.lane, at)[0] : undefined;
          if (child === undefined) return;
          select(view.rows[child]!);
          break;
        }
        case 'n':
        case 'N':
          if (!stepMatch) return;
          stepMatch(event.key === 'n' ? 1 : -1);
          break;
        case '/':
          focusSearch();
          break;
        case 'Enter': {
          // A focused button or link handles Enter itself.
          if (file !== null || isInteractive(event.target)) return;
          void openFirstFile();
          break;
        }
        case 'Escape':
          if (file !== null) {
            closeDiff();
            (document.querySelector('[data-commit-list]') as HTMLElement | null)?.focus({ preventScroll: true });
          } else if (clearFocus) {
            clearFocus();
          } else {
            return;
          }
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

/** The first view row showing a commit below graph row `row` (view rows keep the graph's order); the count when none does. */
function firstShownAfter(view: GraphView, row: number): number {
  let low = 0;
  let high = view.rows.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (view.rows[mid]! > row) high = mid;
    else low = mid + 1;
  }
  return low;
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a, input, select, textarea, summary, [role="button"]') !== null;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

interface ToolbarProps {
  model: GraphModel;
  order: GraphOrder;
  onOrder(order: GraphOrder): void;
  /** How search misses are shown; null without a search. */
  matches: 'dim' | 'hide' | null;
  onMatches(matches: 'dim' | 'hide'): void;
  focusName: string | null;
  focus: BranchFocus | null;
  onClearFocus(): void;
  onSelect(row: number): void;
  switching: boolean;
}

function Toolbar({ model, order, onOrder, matches, onMatches, focusName, focus, onClearFocus, onSelect, switching }: ToolbarProps) {
  const { total } = model.payload.page;
  return (
    <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200 px-3 py-1 text-xs dark:border-zinc-800">
      <span className="text-zinc-500 dark:text-zinc-400">Order</span>
      <Segmented
        label="Graph order"
        value={order}
        options={[
          { value: 'date', label: 'Date', title: 'Newest first: what happened when' },
          { value: 'topo', label: 'Topo', title: "Each branch's commits kept together, fewer crossings" },
        ]}
        onChange={onOrder}
      />
      {matches && (
        <>
          <span className="text-zinc-500 dark:text-zinc-400">Matches</span>
          <Segmented
            label="Search misses"
            value={matches}
            options={[
              { value: 'dim', label: 'Dim', title: 'Show every commit; the ones that don’t match are dimmed' },
              { value: 'hide', label: 'Hide', title: 'Show only the matches, linked through the commits in between' },
            ]}
            onChange={onMatches}
          />
        </>
      )}

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

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; title: string }>;
  onChange(value: T): void;
}) {
  return (
    <div role="group" aria-label={props.label} className="flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={props.value === option.value}
          title={option.title}
          className={cx(
            'px-2 py-0.5',
            props.value === option.value
              ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
          )}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** "12 matches", with buttons for n / N; or why the query can't be used. */
function MatchCount(props: {
  terms: readonly Term[];
  match: QueryMatch | null;
  loading: boolean;
  /** Why message bodies couldn't load; subjects are still searched. */
  bodiesFailed: string | null;
  onStep(direction: 1 | -1): void;
}) {
  const { terms, match, loading, bodiesFailed, onStep } = props;
  if (!match) {
    const problem = terms.find((t) => t.error);
    return problem ? (
      <span className="max-w-48 shrink truncate text-xs text-red-700 dark:text-red-400" title={problem.error}>
        {problem.error}
      </span>
    ) : null;
  }
  const button = 'rounded px-1 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800';
  return (
    <div className="flex shrink-0 items-center gap-0.5 text-xs text-zinc-600 dark:text-zinc-400" data-match-count>
      <span aria-live="polite" className="mr-1 tabular-nums" title={loading ? 'Still reading commit messages: only subjects searched so far' : undefined}>
        {match.count === 0 ? 'No matches' : plural(match.count, 'match', 'matches')}
        {loading && '…'}
      </span>
      {bodiesFailed && (
        <span className="mr-1 text-amber-700 dark:text-amber-400" title={`Couldn’t read the commit messages: ${bodiesFailed}`}>
          (subjects only)
        </span>
      )}
      <button type="button" className={button} aria-label="Previous match" title="Previous match (N)" disabled={match.count === 0} onClick={() => onStep(-1)}>
        ↑
      </button>
      <button type="button" className={button} aria-label="Next match" title="Next match (n)" disabled={match.count === 0} onClick={() => onStep(1)}>
        ↓
      </button>
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
