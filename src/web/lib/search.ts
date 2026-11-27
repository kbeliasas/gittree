import { MAX_PARENTS, type CompareWith, type GraphOrder } from '../../shared/api.ts';

/**
 * PLAN §7: the URL holds the view state — repository, view, selected commit,
 * graph order, focused branch, open diff — so links are bookmarkable and
 * Back/Forward retrace your exploration.
 */
export interface HistorySearch {
  /** Selected commit (full or abbreviated hash); HEAD when absent. */
  sel?: string;
  /** Graph order; date order when absent. */
  order?: GraphOrder;
  /** Focused branch name. */
  focus?: string;
  /** What the selected commit's changes are compared with: a parent number (≥ 2) or `cc`; the first parent when absent. */
  parent?: Exclude<CompareWith, 1>;
  /** Path of the file whose diff is open; the details panel when absent. */
  file?: string;
  /** Ignore whitespace in the diff. */
  ws?: true;
}

const HASH = /^[0-9a-f]{4,64}$/;

export function validateHistorySearch(search: Record<string, unknown>): HistorySearch {
  const result: HistorySearch = {};
  if (typeof search.sel === 'string' && HASH.test(search.sel)) result.sel = search.sel;
  if (search.order === 'topo') result.order = 'topo';
  if (typeof search.focus === 'string' && search.focus !== '' && search.focus.length <= 255) result.focus = search.focus;
  if (search.parent === 'cc') result.parent = 'cc';
  else if (typeof search.parent === 'string' && /^\d{1,2}$/.test(search.parent)) {
    const parent = Number(search.parent);
    if (parent >= 2 && parent <= MAX_PARENTS) result.parent = parent;
  }
  if (typeof search.file === 'string' && search.file !== '' && search.file.length <= 4096) result.file = search.file;
  if (search.ws === '1') result.ws = true;
  return result;
}

/** Plain key=value search params: TanStack's JSON default would turn an all-digit hash into a number. */
export function parseSearch(text: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(text));
}

/** Leaves out empty values; `true` flags are written as `1`. */
export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    params.set(key, value === true ? '1' : String(value));
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}
