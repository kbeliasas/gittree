import { experimental_streamedQuery as streamedQuery, hashKey, useQueries, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SearchEvent, type SearchKind } from '../../../shared/api.ts';
import { errorMessage } from '../../components/Screens.tsx';
import type { GraphModel } from '../../graph/model.ts';
import { streamJson } from '../../lib/api.ts';
import { isApplied, SERVER_KEYS, serverTermKey, type ServerRows, type Term } from '../../lib/query.ts';

/** What one server search has found so far. */
interface Found {
  matches: string[];
  searched: number;
  total: number;
  done: boolean;
  /** Stopped with the Stop button: the matches are partial. */
  stopped: boolean;
  /** A failure after the stream started; one before it is the query's error. */
  failure: string | null;
}

type Chunk = SearchEvent | { type: 'stopped' };

const NOTHING_YET: Found = { matches: [], searched: 0, total: 0, done: false, stopped: false, failure: null };

function reduce(found: Found, chunk: Chunk): Found {
  switch (chunk.type) {
    case 'progress':
      return {
        ...found,
        matches: chunk.matches.length > 0 ? [...found.matches, ...chunk.matches] : found.matches,
        searched: chunk.searched,
        total: chunk.total,
      };
    case 'done':
      return { ...found, searched: chunk.searched, total: chunk.total, done: true };
    case 'error':
      return { ...found, failure: chunk.message };
    case 'stopped':
      return { ...found, stopped: true };
  }
}

/** The Stop button's handle on each running search, by query hash. */
const stoppers = new Map<string, AbortController>();

export interface ServerSearch {
  /** Rows each server term has matched so far, for matchQuery. */
  rows: ServerRows;
  /** Why server terms failed (an invalid regex, contents a partial clone lacks), by serverTermKey. */
  errors: ReadonlyMap<string, string>;
  /** The searches still running or about to start, together; null when there are none. */
  progress: { kinds: SearchKind[]; searched: number; total: number } | null;
  /** Some search was stopped before it finished, so its matches are partial. */
  stopped: boolean;
  /** Stops the running searches; what they found so far stays. */
  stop(): void;
  /** Starts the stopped (or every) search again. */
  restart(): void;
}

/**
 * PLAN §8 server search: one streamed search per `path:`, `content:` or `regex:` term (a term and
 * its negation share one), over the loaded graph's commits. Matches arrive while git works. A
 * search stops when its term leaves the query, or with stop(). Finished searches are cached.
 */
export function useServerSearch(repoId: string, model: GraphModel, terms: readonly Term[]): ServerSearch {
  const queryClient = useQueryClient();
  const { order, snapshot } = model.payload;
  const wanted = useMemo(() => {
    const byKey = new Map<string, Term>();
    for (const term of terms) if (isApplied(term) && SERVER_KEYS.has(term.key)) byKey.set(serverTermKey(term), term);
    return [...byKey];
  }, [terms]);
  // A term being typed waits a moment, so not every keystroke starts a search.
  const settled = useSettled(
    wanted.map(([key]) => key),
    300,
  );

  const keyFor = useCallback((key: string): QueryKey => ['search', repoId, order, snapshot, key], [repoId, order, snapshot]);
  const latest = useQueries({
    queries: wanted.map(([key, term]) => ({
      queryKey: keyFor(key),
      queryFn: streamedQuery<Chunk, Found>({
        streamFn: async function* (context) {
          const hash = hashKey(context.queryKey);
          const stopper = new AbortController();
          stoppers.set(hash, stopper);
          const params = new URLSearchParams({ kind: term.key, value: term.value, order });
          if (term.key === 'regex' && term.flags) params.set('flags', term.flags);
          try {
            yield* streamJson(`/api/repos/${repoId}/search?${params}`, SearchEvent, AbortSignal.any([context.signal, stopper.signal]));
          } catch (error) {
            if (!stopper.signal.aborted || context.signal.aborted) throw error;
            yield { type: 'stopped' };
          } finally {
            if (stoppers.get(hash) === stopper) stoppers.delete(hash);
          }
        },
        reducer: reduce,
        initialValue: NOTHING_YET,
      }),
      enabled: settled.has(key),
      retry: false,
      // Finished or stopped searches stay; one cut off by leaving runs again when it is back.
      staleTime: (query: { state: { data: Found | undefined } }) => (query.state.data?.done || query.state.data?.stopped ? Infinity : 0),
      gcTime: 5 * 60_000,
    })),
    combine: pickStates,
  });
  // The same array while no search has new data, so the masks below aren't rebuilt on every render.
  const previous = useRef<SearchQueryState[]>([]);
  const states = sameStates(previous.current, latest) ? previous.current : (previous.current = latest);

  const rows = useMemo(() => {
    const map = new Map<string, Uint8Array>();
    wanted.forEach(([key], i) => {
      const found = states[i]?.data;
      if (!found) return;
      const mask = new Uint8Array(model.count);
      for (const sha of found.matches) {
        const row = model.rowOf.get(sha);
        if (row !== undefined) mask[row] = 1;
      }
      map.set(key, mask);
    });
    return map;
  }, [wanted, states, model]);

  const errors = useMemo(() => {
    const map = new Map<string, string>();
    wanted.forEach(([key], i) => {
      const state = states[i];
      const message = state?.error ? errorMessage(state.error) : state?.data?.failure;
      if (message) map.set(key, message);
    });
    return map;
  }, [wanted, states]);

  const progress = useMemo(() => {
    const running = wanted.filter(([key], i) => {
      const state = states[i];
      return !errors.has(key) && !state?.data?.done && !state?.data?.stopped;
    });
    if (running.length === 0) return null;
    let searched = 0;
    let total = 0;
    for (const [key] of running) {
      const found = states[wanted.findIndex(([k]) => k === key)]?.data;
      searched += found?.searched ?? 0;
      total += found?.total || model.count;
    }
    const kinds = [...new Set(running.map(([, term]) => term.key as SearchKind))];
    return { kinds, searched, total };
  }, [wanted, states, errors, model.count]);

  const stop = useCallback(() => {
    for (const [key] of wanted) stoppers.get(hashKey(keyFor(key)))?.abort();
  }, [wanted, keyFor]);
  const restart = useCallback(() => {
    void queryClient.resetQueries({ queryKey: ['search', repoId, order, snapshot] });
  }, [queryClient, repoId, order, snapshot]);

  return { rows, errors, progress, stopped: states.some((s) => s.data?.stopped === true), stop, restart };
}

interface SearchQueryState {
  data: Found | undefined;
  error: Error | null;
}

function pickStates(results: ReadonlyArray<{ data: Found | undefined; error: Error | null }>): SearchQueryState[] {
  return results.map(({ data, error }) => ({ data, error }));
}

function sameStates(a: readonly SearchQueryState[], b: readonly SearchQueryState[]): boolean {
  return a.length === b.length && a.every((state, i) => state.data === b[i]!.data && state.error === b[i]!.error);
}

/** The keys once they have stayed the same for `delay` ms; the first ones right away. */
function useSettled(keys: readonly string[], delay: number): ReadonlySet<string> {
  const joined = keys.join('\u0001');
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set(keys));
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(new Set(joined === '' ? [] : joined.split('\u0001'))), delay);
    return () => window.clearTimeout(timer);
  }, [joined, delay]);
  return settled;
}
