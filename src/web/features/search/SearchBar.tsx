import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

import { cx } from '../../lib/cx.ts';
import { removeTerm, suggest, type SuggestionSource, type Term } from '../../lib/query.ts';

interface SearchBarProps {
  /** The query in the URL. */
  value: string;
  /** `value`'s terms, with errors only the server knows (an invalid regex, …), for the chips. */
  terms: readonly Term[];
  /** `push` starts a Back entry; the rest of one editing session replaces it. */
  onChange(query: string, history: 'push' | 'replace'): void;
  suggestions: SuggestionSource;
  /** The bar got the focus: a good moment to load what search needs. */
  onActivate(): void;
  /** Enter: go to the results. `history` is how to store a changed query, null when it is unchanged. */
  onSubmit(query: string, history: 'push' | 'replace' | null): void;
  /** Esc: back to the commit list. */
  onLeave(): void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/** Applied this long after the last keystroke. */
const TYPING_DELAY_MS = 150;

/**
 * PLAN §8 "one bar with chips": a text field with completions while it has
 * the focus, and the query's terms as removable chips while it hasn't.
 */
export function SearchBar({ value, terms, onChange, suggestions, onActivate, onSubmit, onLeave, inputRef }: SearchBarProps) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const sent = useRef(value);
  const pushed = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();

  // Back/Forward, a removed chip or a picked ticket change the query from outside.
  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    setDraft(value);
  }, [value]);

  /** Takes the text as the query: how to store it in the history, or null when it hasn't changed. */
  const take = useCallback((text: string): 'push' | 'replace' | null => {
    window.clearTimeout(timer.current);
    const query = text.trim();
    if (query === sent.current) return null;
    sent.current = query;
    const history = pushed.current ? 'replace' : 'push';
    pushed.current = true;
    return history;
  }, []);
  const send = useCallback(
    (text: string) => {
      const history = take(text);
      if (history) onChange(text.trim(), history);
    },
    [take, onChange],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const edit = (text: string, at: number) => {
    setDraft(text);
    setCaret(at);
    setActive(-1);
    setDismissed(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => send(text), TYPING_DELAY_MS);
  };

  const completions = useMemo(
    () => (editing && !dismissed ? suggest(draft, caret, suggestions) : null),
    [editing, dismissed, draft, caret, suggestions],
  );
  const items = completions?.items ?? [];
  const open = items.length > 0;

  const accept = (index: number) => {
    const item = items[index];
    if (!item || !completions) return;
    const text = draft.slice(0, completions.start) + item.insert + draft.slice(completions.end);
    const at = completions.start + item.insert.length;
    pendingCaret.current = at;
    edit(text, at);
  };
  useLayoutEffect(() => {
    if (pendingCaret.current === null || !inputRef.current) return;
    inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        if (!open) {
          if (!dismissed) return;
          setDismissed(false);
          break;
        }
        setActive((a) => (a + 1) % items.length);
        break;
      case 'ArrowUp':
        if (!open) return;
        setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
        break;
      case 'Tab':
        if (!open || event.shiftKey) return;
        accept(Math.max(0, active));
        break;
      case 'Enter':
        if (open && active >= 0) {
          accept(active);
          break;
        }
        onSubmit(draft.trim(), take(draft));
        inputRef.current?.blur();
        break;
      case 'Escape':
        if (open) {
          setDismissed(true);
          break;
        }
        send(draft);
        inputRef.current?.blur();
        onLeave();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const focusAt = (at: number) => {
    pendingCaret.current = at;
    inputRef.current?.focus();
  };

  const showChips = !editing && terms.length > 0;

  return (
    <div className="relative min-w-0 flex-1">
      <div
        className={cx(
          'relative flex h-7 items-center rounded border bg-[var(--page-bg)] pr-1 pl-2 text-xs',
          editing ? 'border-sky-500 ring-1 ring-sky-500' : 'border-zinc-300 dark:border-zinc-700',
        )}
      >
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search commits"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search: author:alice jira:SHOP-12 login (press /)"
          className={cx('h-full min-w-0 flex-1 bg-transparent pl-1.5 font-mono outline-none placeholder:font-sans placeholder:text-zinc-400', showChips && 'opacity-0')}
          value={draft}
          onChange={(event) => edit(event.target.value, event.target.selectionStart ?? event.target.value.length)}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onFocus={() => {
            setEditing(true);
            pushed.current = false;
            onActivate();
          }}
          onBlur={() => {
            setEditing(false);
            setActive(-1);
            setDismissed(false);
            send(draft);
          }}
          onKeyDown={onKeyDown}
        />
        {showChips && (
          // Over the field while it isn't focused; a click edits the query.
          <div className="absolute inset-y-0 right-7 left-7 flex items-center gap-1 overflow-hidden" onMouseDown={(event) => event.preventDefault()} onClick={() => focusAt(value.length)}>
            {terms.map((term) => (
              <Chip
                key={`${term.start}:${term.end}`}
                term={term}
                onEdit={() => focusAt(term.end)}
                onRemove={() => onChange(removeTerm(value, term), 'push')}
              />
            ))}
          </div>
        )}
        {value !== '' && (
          <button
            type="button"
            aria-label="Clear search"
            title="Clear search"
            className="ml-1 shrink-0 rounded px-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              window.clearTimeout(timer.current);
              onChange('', 'push');
            }}
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-auto rounded border border-zinc-200 bg-[var(--page-bg)] py-1 text-xs shadow-lg dark:border-zinc-700"
          onMouseDown={(event) => event.preventDefault()} // keep the focus in the field
        >
          {items.map((item, i) => (
            <li
              key={`${item.insert}:${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cx('flex cursor-default items-baseline gap-2 px-2 py-1', i === active && 'bg-sky-100 dark:bg-sky-900')}
              onMouseEnter={() => setActive(i)}
              onClick={() => accept(i)}
            >
              <span className="shrink-0 font-mono">{item.label}</span>
              {item.detail && <span className="truncate text-zinc-500 dark:text-zinc-400">{item.detail}</span>}
            </li>
          ))}
          <li role="presentation" className="border-t border-zinc-100 px-2 pt-1 text-[10px] text-zinc-400 dark:border-zinc-800">
            Tab completes · Enter goes to the results · Esc closes
          </li>
        </ul>
      )}
    </div>
  );
}

function Chip({ term, onEdit, onRemove }: { term: Term; onEdit(): void; onRemove(): void }) {
  const label = term.key === 'text' ? null : `${term.key}:`;
  const value = term.quoted && term.key !== 'regex' ? `"${term.value}"` : term.key === 'regex' ? `/${term.value}/${term.flags ?? ''}` : term.value;
  return (
    <span
      data-chip={term.key}
      data-negated={term.negate ? 'true' : undefined}
      title={term.error ?? (term.negate ? 'Leaves out commits that match' : undefined)}
      className={cx(
        'flex max-w-60 shrink-0 cursor-text items-center gap-0.5 rounded-full border py-px pr-0.5 pl-2',
        term.error
          ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
          : term.negate
            ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'
            : 'border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800',
      )}
      onClick={(event) => {
        event.stopPropagation();
        onEdit();
      }}
    >
      {term.negate && <span className="font-semibold">not</span>}
      {label && <span className="text-zinc-500 dark:text-zinc-400">{label}</span>}
      <span className="truncate font-mono">{value || '…'}</span>
      <button
        type="button"
        aria-label={`Remove ${term.negate ? '-' : ''}${label ?? ''}${value}`}
        className="ml-0.5 rounded-full px-1 text-zinc-500 hover:bg-zinc-300 dark:hover:bg-zinc-600"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        ✕
      </button>
    </span>
  );
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-zinc-400">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
