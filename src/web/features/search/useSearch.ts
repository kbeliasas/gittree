import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { errorMessage } from '../../components/Screens.tsx';
import { parentCount } from '../../graph/dag.ts';
import { jiraMatcher } from '../../lib/jira.ts';
import { messagesQuery, settingsQuery, treeQuery } from '../../lib/queries.ts';
import {
  buildSearchIndex,
  matchQuery,
  parseQuery,
  SERVER_KEYS,
  serverTermKey,
  type QueryMatch,
  type SuggestionSource,
  type Term,
} from '../../lib/query.ts';
import type { LoadedGraph } from '../history/state.ts';
import { useServerSearch, type ServerSearch } from './useServerSearch.ts';

export interface Ticket {
  key: string;
  /** Commits that mention it, or whose branch name does. */
  commits: number;
}

export interface SearchResult {
  /** The query's terms; server terms that failed carry their error. */
  terms: Term[];
  /** The rows the query matches; null when it selects by nothing. */
  match: QueryMatch | null;
  /** Message bodies are still loading; until then free text and Jira keys only see subjects. */
  loadingBodies: boolean;
  /** Why the bodies couldn't load, if they couldn't; subjects are still searched. */
  bodiesError: string | null;
  suggestions: SuggestionSource;
  /** Jira keys in the loaded history, most commits first. */
  tickets: Ticket[];
  /** Runs another query against the same commits (for Enter, before the URL has the new query). */
  matchFor(query: string): QueryMatch | null;
  /** `path:`, `content:` and `regex:` searches on the server. */
  server: Omit<ServerSearch, 'rows' | 'errors'>;
}

/**
 * PLAN §8 search: the query against subjects, bodies, hashes, refs, authors,
 * dates and Jira keys of the loaded graph, in the browser, plus `path:`,
 * `content:` and `regex:` terms the server answers. Bodies and HEAD's file list
 * (for `path:` suggestions) load once something asks for them (`wantBodies`, or
 * any query).
 */
export function useSearch(repoId: string, graph: LoadedGraph, query: string, wantBodies: boolean): SearchResult {
  const { model, analysis } = graph;
  const parsed = useMemo(() => parseQuery(query), [query]);
  const { rows: serverRows, errors: serverErrors, ...server } = useServerSearch(repoId, model, parsed);
  const terms = useMemo(
    () =>
      serverErrors.size === 0
        ? parsed
        : parsed.map((term) => {
            const error = SERVER_KEYS.has(term.key) ? serverErrors.get(serverTermKey(term)) : undefined;
            return error && !term.error ? { ...term, error } : term;
          }),
    [parsed, serverErrors],
  );
  const headSha = model.payload.head.sha;
  const tree = useQuery({ ...treeQuery(repoId, headSha ?? ''), enabled: wantBodies && headSha !== null });
  const messages = useQuery({
    ...messagesQuery(repoId, model.payload.order, model.payload.snapshot),
    enabled: wantBodies || query.trim() !== '',
  });
  // Keyed by hash, so bodies from a slightly different snapshot are still right.
  const bodies = messages.data?.bodies ?? null;
  const settings = useQuery(settingsQuery()).data;
  const matcher = useMemo(() => jiraMatcher(settings?.jira.projectKeys ?? []), [settings]);

  const index = useMemo(
    () =>
      buildSearchIndex({
        shas: model.commits.map((c) => c.sha),
        subjects: model.commits.map((c) => c.subject),
        bodies,
        authorOf: model.commits.map((c) => c.author),
        authors: model.payload.authors,
        authorTime: model.commits.map((c) => c.authorTime),
        merge: Uint8Array.from(model.commits, (_, row) => (parentCount(model, row) > 1 ? 1 : 0)),
        refsAt: model.refsAt,
        lineName: (row) => analysis.lines.list[analysis.lines.owner[row]!]?.name ?? '',
        jira: matcher,
      }),
    [model, analysis, bodies, matcher],
  );
  const match = useMemo(() => matchQuery(terms, index, new Date(), serverRows), [terms, index, serverRows]);

  const tickets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const keys of index.jira) for (const key of keys ?? []) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts]
      .map(([key, commits]) => ({ key, commits }))
      .sort((a, b) => b.commits - a.commits || a.key.localeCompare(b.key, undefined, { numeric: true }));
  }, [index]);

  const suggestions = useMemo((): SuggestionSource => {
    const commits = new Array<number>(model.payload.authors.length).fill(0);
    for (const commit of model.commits) commits[commit.author]!++;
    return {
      authors: model.payload.authors.map((author, i) => ({ ...author, commits: commits[i]! })),
      refs: model.payload.refs.map(({ name, kind }) => ({ name, kind })),
      jira: tickets,
      paths: tree.data?.paths ?? null,
    };
  }, [model, tickets, tree.data]);

  const matchFor = useCallback((other: string) => matchQuery(parseQuery(other), index, new Date(), serverRows), [index, serverRows]);

  return {
    terms,
    match,
    loadingBodies: messages.isPending && messages.fetchStatus === 'fetching',
    bodiesError: messages.error ? errorMessage(messages.error) : null,
    suggestions,
    tickets,
    matchFor,
    server,
  };
}

/** The next matching row after `from` (or before it, going back), wrapping around; -1 when nothing matches. */
export function nextMatch(rows: Uint8Array, from: number, direction: 1 | -1): number {
  const n = rows.length;
  for (let step = 1; step <= n; step++) {
    const row = (((from + direction * step) % n) + n) % n;
    if (rows[row]) return row;
  }
  return -1;
}
