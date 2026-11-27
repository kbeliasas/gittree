import { useEffect, useId, useRef, useState } from 'react';

import { cx } from '../../lib/cx.ts';
import { jiraUrl } from '../../lib/jira.ts';
import type { Term } from '../../lib/query.ts';
import type { Ticket } from './useSearch.ts';

interface TicketListProps {
  tickets: readonly Ticket[];
  /** The current query's terms: tickets it already searches for are ticked. */
  terms: readonly Term[];
  jiraBase: string | null;
  loading: boolean;
  onToggle(key: string): void;
  /** Opened: a good moment to load the message bodies the counts come from. */
  onOpen(): void;
}

/** PLAN §8's ticket facet: the Jira keys in the loaded history with their commit counts; a pick toggles `jira:KEY`. */
export function TicketList({ tickets, terms, jiraBase, loading, onToggle, onOpen }: TicketListProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    // Capture: Esc closes this list before the History view's Esc handling sees it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  if (tickets.length === 0) return null;
  const searched = new Set(terms.filter((t) => t.key === 'jira' && !t.negate && !t.error).map((t) => t.value.toUpperCase()));

  return (
    <div ref={box} className="relative shrink-0">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        title="Jira issues in this history"
        className={cx(
          'flex h-7 items-center gap-1 rounded border px-2 text-xs',
          open || searched.size > 0
            ? 'border-sky-400 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100'
            : 'border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800',
        )}
        onClick={() => {
          if (!open) onOpen();
          setOpen(!open);
        }}
      >
        Tickets <span className="rounded-full bg-zinc-200 px-1.5 tabular-nums dark:bg-zinc-700">{tickets.length}</span>
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Jira tickets"
          className="absolute top-full right-0 z-30 mt-1 max-h-80 w-64 overflow-auto rounded border border-zinc-200 bg-[var(--page-bg)] py-1 text-xs shadow-lg dark:border-zinc-700"
        >
          {loading && <p className="px-2 py-1 text-zinc-500">Reading commit messages…</p>}
          <ul>
            {tickets.map((ticket) => {
              const on = searched.has(ticket.key);
              return (
                <li key={ticket.key} className="flex items-center">
                  <button
                    type="button"
                    aria-pressed={on}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    onClick={() => onToggle(ticket.key)}
                  >
                    <span aria-hidden="true" className={cx('w-3 text-sky-600 dark:text-sky-300', !on && 'invisible')}>
                      ✓
                    </span>
                    <span className="flex-1 truncate font-mono">{ticket.key}</span>
                    <span className="text-zinc-500 tabular-nums dark:text-zinc-400">{ticket.commits}</span>
                  </button>
                  {jiraBase && (
                    <a
                      className="px-2 py-1 text-sky-700 hover:underline dark:text-sky-300"
                      href={jiraUrl(jiraBase, ticket.key)}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`Open ${ticket.key} in Jira`}
                      title={`Open ${ticket.key} in Jira`}
                    >
                      ↗
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
