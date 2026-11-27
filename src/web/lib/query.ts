import type { RefKind } from '../../shared/api.ts';
import type { JiraMatcher } from './jira.ts';

/**
 * The History search syntax (PLAN §8): free text plus `key:value` tokens, each
 * of them negated by a leading `-`. Values with spaces go in double quotes.
 * Different keys and free-text words must all match; one key given twice
 * matches either value (`author:alice author:bob`).
 */

export const SEARCH_KEYS = ['author', 'after', 'before', 'ref', 'jira', 'merges', 'path', 'content', 'regex'] as const;
export type SearchKey = (typeof SEARCH_KEYS)[number];

/** Keys that git answers on the server; they arrive with server search. */
export const SERVER_KEYS: ReadonlySet<SearchKey> = new Set(['path', 'content', 'regex']);

/** Repeating one of these keys widens the search (either value matches); other terms all have to match. */
const EITHER_KEYS: ReadonlySet<string> = new Set(['author', 'ref', 'jira', 'path', 'content', 'regex']);

export interface Term {
  key: SearchKey | 'text';
  /** Without quotes (or slashes, for regex:). */
  value: string;
  negate: boolean;
  /** The value was quoted (or, for regex:, between slashes). */
  quoted: boolean;
  /** regex: only — flags after the closing slash. */
  flags?: string;
  /** Where the term is in the query: [start, end). */
  start: number;
  end: number;
  /** Why the term can't be used; it is then left out of the search. */
  error?: string;
}

const KEY_SET: ReadonlySet<string> = new Set(SEARCH_KEYS);
const isSpace = (char: string | undefined) => char !== undefined && /\s/.test(char);

export function parseQuery(text: string): Term[] {
  const terms: Term[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    while (i < n && isSpace(text[i])) i++;
    if (i >= n) break;
    const start = i;
    let negate = false;
    if (text[i] === '-' && i + 1 < n && !isSpace(text[i + 1])) {
      negate = true;
      i++;
    }

    let key: Term['key'] = 'text';
    const keyMatch = /^([A-Za-z]+):/.exec(text.slice(i, i + 16));
    if (keyMatch && KEY_SET.has(keyMatch[1]!.toLowerCase())) {
      key = keyMatch[1]!.toLowerCase() as SearchKey;
      i += keyMatch[0].length;
    }

    let value = '';
    let quoted = false;
    let flags: string | undefined;
    let error: string | undefined;
    if (text[i] === '"') {
      quoted = true;
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) i++;
        value += text[i];
        i++;
      }
      if (i < n) i++; // the closing quote
    } else if (key === 'regex' && text[i] === '/') {
      quoted = true;
      i++;
      while (i < n && text[i] !== '/') {
        if (text[i] === '\\' && text[i + 1] === '/') i++; // \/ is a slash; other escapes belong to the pattern
        value += text[i];
        i++;
      }
      if (i < n) {
        i++; // the closing slash
        flags = /^[a-z]*/.exec(text.slice(i))![0];
        i += flags.length;
      } else {
        error = 'Close the pattern with /';
      }
    }
    // Anything glued on (an unquoted value, or text right after a closing quote) belongs to the term.
    while (i < n && !isSpace(text[i])) value += text[i++];

    const term: Term = { key, value, negate, quoted, start, end: i };
    if (flags !== undefined) term.flags = flags;
    error ??= termError(term);
    if (error) term.error = error;
    terms.push(term);
  }
  return terms;
}

function termError(term: Term): string | undefined {
  if (term.key === 'text' || term.value === '') return undefined;
  if (SERVER_KEYS.has(term.key)) return `${term.key}: search isn't available yet`;
  if ((term.key === 'after' || term.key === 'before') && parseDateBound(term.value, new Date()) === null) {
    return 'Use a date like 2025-03-01, today, yesterday, or an age like 2w, 3m, 1y';
  }
  if (term.key === 'merges' && !/^(?:only|none)$/i.test(term.value)) return 'Use merges:only or merges:none';
  return undefined;
}

/** Whether a term takes part in the search: it has a value and no error. */
export function isApplied(term: Term): boolean {
  return term.value !== '' && term.error === undefined;
}

/**
 * The time (unix seconds) a date value stands for: the start of that day in
 * local time (`2025-03-01`, `today`, `yesterday`), or an age before `now`
 * (`3d`, `2w`, `6m` or `6mo`, `1y`). Null when the value is neither.
 */
export function parseDateBound(value: string, now: Date): number | null {
  const text = value.trim().toLowerCase();
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;
  if (text === 'today') return startOfDay(now);
  if (text === 'yesterday') return startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    const date = new Date(year, month - 1, day);
    // Reject dates that roll over, such as 2025-02-30.
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date.getTime() / 1000;
  }

  const age = /^(\d{1,4})(d|w|m|mo|y)$/.exec(text);
  if (age) {
    const amount = Number(age[1]);
    const then = new Date(now);
    if (age[2] === 'd') then.setDate(then.getDate() - amount);
    else if (age[2] === 'w') then.setDate(then.getDate() - 7 * amount);
    else if (age[2] === 'y') then.setFullYear(then.getFullYear() - amount);
    else then.setMonth(then.getMonth() - amount);
    return Math.floor(then.getTime() / 1000);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Matching

/** What the search looks at, per row of the loaded graph. */
export interface SearchIndex {
  count: number;
  /** Subject and body, lowercased. */
  text: readonly string[];
  shas: readonly string[];
  /** Lowercased names of the refs at each row; remote branches also without the remote ("origin/main" and "main"). */
  refs: ReadonlyArray<readonly string[] | undefined>;
  authorOf: ArrayLike<number>;
  /** Per author: lowercased name and email. */
  authors: readonly string[];
  authorTime: ArrayLike<number>;
  /** 1 for merge commits. */
  merge: ArrayLike<number>;
  /** Jira keys in each row's message or in the name of its branch line. */
  jira: ReadonlyArray<readonly string[] | undefined>;
}

export interface SearchSource {
  shas: readonly string[];
  subjects: readonly string[];
  /** Message bodies by hash; null while they load (subjects are searched meanwhile). */
  bodies: Readonly<Record<string, string>> | null;
  authorOf: ArrayLike<number>;
  authors: ReadonlyArray<{ name: string; email: string }>;
  authorTime: ArrayLike<number>;
  merge: ArrayLike<number>;
  refsAt: ReadonlyMap<number, ReadonlyArray<{ name: string; kind: RefKind }>>;
  /** Name of the branch line a row belongs to, e.g. "feature/SHOP-12-login". */
  lineName(row: number): string;
  jira: JiraMatcher;
}

export function buildSearchIndex(source: SearchSource): SearchIndex {
  const count = source.shas.length;
  const text: string[] = new Array<string>(count);
  const refs: Array<string[] | undefined> = new Array<string[] | undefined>(count);
  const jira: Array<string[] | undefined> = new Array<string[] | undefined>(count);
  for (let row = 0; row < count; row++) {
    const sha = source.shas[row]!;
    const subject = source.subjects[row] ?? '';
    const body = source.bodies?.[sha];
    const message = body ? `${subject}\n${body}` : subject;
    text[row] = message.toLowerCase();
    const keys = new Set(source.jira(`${message}\n${source.lineName(row)}`).map((match) => match.key));
    if (keys.size > 0) jira[row] = [...keys];
  }
  for (const [row, list] of source.refsAt) {
    if (row < 0 || row >= count) continue;
    const names: string[] = [];
    for (const ref of list) {
      const name = ref.name.toLowerCase();
      names.push(name);
      if (ref.kind === 'remote' && name.includes('/')) names.push(name.slice(name.indexOf('/') + 1));
    }
    refs[row] = names;
  }
  return {
    count,
    text,
    shas: source.shas,
    refs,
    authorOf: source.authorOf,
    authors: source.authors.map((a) => `${a.name}\n${a.email}`.toLowerCase()),
    authorTime: source.authorTime,
    merge: source.merge,
    jira,
  };
}

export interface QueryMatch {
  /** 1 for rows that match. */
  rows: Uint8Array;
  count: number;
}

type Predicate = (row: number) => boolean;

/**
 * The rows the query selects, or null when it has nothing to search for (empty,
 * or only unfinished or invalid terms). Unsupported terms are left out.
 */
export function matchQuery(terms: readonly Term[], index: SearchIndex, now: Date): QueryMatch | null {
  const groups = new Map<string, Predicate[]>();
  const excluded: Predicate[] = [];
  terms.forEach((term, i) => {
    if (!isApplied(term)) return;
    const predicate = compile(term, index, now);
    if (!predicate) return;
    if (term.negate) {
      excluded.push(predicate);
      return;
    }
    const group = EITHER_KEYS.has(term.key) ? term.key : `${term.key}#${i}`;
    const list = groups.get(group);
    if (list) list.push(predicate);
    else groups.set(group, [predicate]);
  });
  if (groups.size === 0 && excluded.length === 0) return null;

  const required = [...groups.values()];
  const rows = new Uint8Array(index.count);
  let count = 0;
  for (let row = 0; row < index.count; row++) {
    if (required.every((either) => either.some((p) => p(row))) && !excluded.some((p) => p(row))) {
      rows[row] = 1;
      count++;
    }
  }
  return { rows, count };
}

function compile(term: Term, index: SearchIndex, now: Date): Predicate | null {
  const value = term.value.toLowerCase();
  switch (term.key) {
    case 'text': {
      const hash = /^[0-9a-f]{4,}$/.test(value);
      return (row) =>
        index.text[row]!.includes(value) ||
        (hash && index.shas[row]!.startsWith(value)) ||
        (index.refs[row]?.some((name) => name.includes(value)) ?? false);
    }
    case 'author': {
      const hits = index.authors.map((author) => author.includes(value));
      return (row) => hits[index.authorOf[row]!] === true;
    }
    case 'ref': {
      const pattern = globPattern(value);
      return (row) => index.refs[row]?.some((name) => pattern.test(name)) ?? false;
    }
    case 'jira': {
      const key = term.value.toUpperCase();
      // A project ("SHOP") matches all of its issues.
      const project = key.includes('-') ? null : `${key}-`;
      return (row) => index.jira[row]?.some((k) => (project ? k.startsWith(project) : k === key)) ?? false;
    }
    case 'after':
    case 'before': {
      const bound = parseDateBound(term.value, now);
      if (bound === null) return null;
      return term.key === 'after' ? (row) => index.authorTime[row]! >= bound : (row) => index.authorTime[row]! < bound;
    }
    case 'merges':
      return value === 'only' ? (row) => index.merge[row] === 1 : (row) => index.merge[row] !== 1;
    default:
      return null;
  }
}

/** `*` any run of characters, `?` one; the whole name has to match. */
function globPattern(glob: string): RegExp {
  const source = [...glob].map((char) => (char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp(`^${source}$`);
}

// ---------------------------------------------------------------------------
// Editing

/** A value as it has to be typed: quoted when it has spaces or quotes. */
export function quoteValue(value: string): string {
  return /[\s"]/.test(value) || value === '' ? `"${value.replace(/["\\]/g, '\\$&')}"` : value;
}

/** The query without one of its terms. */
export function removeTerm(query: string, term: Pick<Term, 'start' | 'end'>): string {
  const before = query.slice(0, term.start).trimEnd();
  const after = query.slice(term.end).trimStart();
  return before && after ? `${before} ${after}` : before + after;
}

/** The query with a term added at the end. */
export function addTerm(query: string, text: string): string {
  const trimmed = query.trimEnd();
  return trimmed ? `${trimmed} ${text}` : text;
}

/** Adds `jira:KEY`, or removes it when the query already has it. */
export function toggleJira(query: string, key: string): string {
  const existing = parseQuery(query).find((t) => t.key === 'jira' && !t.negate && t.value.toUpperCase() === key.toUpperCase());
  return existing ? removeTerm(query, existing) : addTerm(query, `jira:${key}`);
}

/** The term the caret is in or right after; an empty one between terms. */
export function termAt(terms: readonly Term[], caret: number): Pick<Term, 'start' | 'end'> {
  return terms.find((t) => t.start <= caret && caret <= t.end) ?? { start: caret, end: caret };
}

// ---------------------------------------------------------------------------
// Suggestions

export interface Suggestion {
  label: string;
  detail?: string;
  /** Replaces the term at the caret. */
  insert: string;
}

export interface SuggestionSource {
  authors: ReadonlyArray<{ name: string; email: string; commits: number }>;
  refs: ReadonlyArray<{ name: string; kind: RefKind }>;
  jira: ReadonlyArray<{ key: string; commits: number }>;
}

export interface Suggestions {
  items: Suggestion[];
  /** The part of the query an accepted suggestion replaces. */
  start: number;
  end: number;
}

const KEY_HINTS: ReadonlyArray<{ key: SearchKey; detail: string }> = [
  { key: 'author', detail: 'Name or email' },
  { key: 'after', detail: 'On or after a date: 2025-03-01, 2w, 3m' },
  { key: 'before', detail: 'Before a date: 2025-03-01, 1y' },
  { key: 'ref', detail: 'Branch or tag on the commit; * and ? match anything' },
  { key: 'jira', detail: 'Jira issue (SHOP-12) or project (SHOP)' },
  { key: 'merges', detail: 'only or none' },
];

const DATE_HINTS: ReadonlyArray<{ value: string; after: string; before: string }> = [
  { value: 'today', after: 'Today', before: 'Before today' },
  { value: 'yesterday', after: 'Since yesterday', before: 'Before yesterday' },
  { value: '1w', after: 'In the last week', before: 'More than a week ago' },
  { value: '1m', after: 'In the last month', before: 'More than a month ago' },
  { value: '3m', after: 'In the last 3 months', before: 'More than 3 months ago' },
  { value: '1y', after: 'In the last year', before: 'More than a year ago' },
];

const MAX_SUGGESTIONS = 8;

/** Completions for the term at the caret: key names, then values (authors, refs, Jira keys, dates). */
export function suggest(query: string, caret: number, source: SuggestionSource): Suggestions {
  const terms = parseQuery(query);
  const { start, end } = termAt(terms, caret);
  const none = { items: [], start, end };
  const typed = query.slice(start, caret);
  // An empty bar lists the keys; between terms it stays quiet.
  if (typed === '' && query.trim() !== '') return none;

  const negate = typed.startsWith('-') ? '-' : '';
  const rest = typed.slice(negate.length);
  const keyed = /^([A-Za-z]+):(.*)$/s.exec(rest);
  if (!keyed) {
    if (rest.includes(':') || rest.startsWith('"')) return none;
    const prefix = rest.toLowerCase();
    const items = KEY_HINTS.filter((hint) => hint.key.startsWith(prefix)).map((hint) => ({
      label: `${negate}${hint.key}:`,
      detail: hint.detail,
      insert: `${negate}${hint.key}:`,
    }));
    return { items, start, end };
  }

  const key = keyed[1]!.toLowerCase();
  const partial = keyed[2]!.replace(/^"|"$/g, '').toLowerCase();
  const value = (text: string) => `${negate}${key}:${quoteValue(text)} `;
  let items: Suggestion[] = [];
  switch (key) {
    case 'author':
      items = source.authors
        .filter((a) => a.name.toLowerCase().includes(partial) || a.email.toLowerCase().includes(partial))
        .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
        .map((a) => ({ label: a.name, detail: `${a.email} · ${a.commits} commit${a.commits === 1 ? '' : 's'}`, insert: value(a.name) }));
      break;
    case 'ref': {
      const rank: Record<RefKind, number> = { local: 0, remote: 1, tag: 2 };
      items = source.refs
        .filter((r) => r.name.toLowerCase().includes(partial))
        .sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name))
        .map((r) => ({ label: r.name, detail: r.kind === 'local' ? 'branch' : r.kind === 'remote' ? 'remote branch' : 'tag', insert: value(r.name) }));
      break;
    }
    case 'jira':
      items = source.jira
        .filter((j) => j.key.toLowerCase().includes(partial))
        .sort((a, b) => b.commits - a.commits || a.key.localeCompare(b.key, undefined, { numeric: true }))
        .map((j) => ({ label: j.key, detail: `${j.commits} commit${j.commits === 1 ? '' : 's'}`, insert: value(j.key) }));
      break;
    case 'merges':
      items = [
        { label: 'only', detail: 'Merge commits only', insert: value('only') },
        { label: 'none', detail: 'No merge commits', insert: value('none') },
      ].filter((s) => s.label.startsWith(partial));
      break;
    case 'after':
    case 'before':
      items = DATE_HINTS.filter((hint) => hint.value.startsWith(partial)).map((hint) => ({
        label: hint.value,
        detail: key === 'after' ? hint.after : hint.before,
        insert: value(hint.value),
      }));
      break;
  }
  // Nothing to add once the value is typed out in full.
  if (items.length === 1 && items[0]!.insert.trimEnd() === query.slice(start, end)) items = [];
  return { items: items.slice(0, MAX_SUGGESTIONS), start, end };
}
