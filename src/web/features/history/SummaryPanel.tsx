import { useState, type ReactNode } from 'react';

import { childrenByLine } from '../../graph/model.ts';
import { dateTime, longAge, numberFormat, shortSha } from '../../lib/format.ts';
import type { LoadedGraph } from './state.ts';

interface SummaryPanelProps {
  graph: LoadedGraph;
  row: number;
  onSelect(row: number): void;
}

/** The selected commit, from what the graph already has (PLAN M1; full details arrive in M2). */
export function SummaryPanel({ graph, row, onSelect }: SummaryPanelProps) {
  const { model, analysis } = graph;
  const commit = model.commits[row];
  if (!commit) return <aside className={PANEL} />;

  const author = model.payload.authors[commit.author];
  const line = analysis.lines.list[analysis.lines.owner[row]!];
  const refs = model.refsAt.get(row) ?? [];
  const parents: number[] = [];
  let unloadedParents = 0;
  for (let k = model.parentStart[row]!; k < model.parentStart[row + 1]!; k++) {
    const parent = model.parentIdx[k]!;
    if (parent < model.count) parents.push(parent);
    else unloadedParents++;
  }
  const children = childrenByLine(model, analysis.layout.lane, row);

  const commitLink = (target: number) => (
    <button
      key={target}
      type="button"
      className="rounded px-1 font-mono text-xs text-sky-700 hover:bg-sky-50 hover:underline dark:text-sky-300 dark:hover:bg-sky-950"
      title={model.commits[target]?.subject}
      onClick={() => onSelect(target)}
    >
      {shortSha(model.commits[target]!.sha)}
    </button>
  );

  return (
    <aside className={PANEL} aria-label="Selected commit">
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 font-mono text-xs break-all text-zinc-600 select-all dark:text-zinc-400">{commit.sha}</code>
        <CopyButton text={commit.sha} />
      </div>
      <h2 className="mt-2 text-sm leading-snug font-semibold break-words">{commit.subject}</h2>

      <p className="mt-3 text-sm">
        {author?.name} <span className="text-zinc-500 dark:text-zinc-400">&lt;{author?.email}&gt;</span>
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {longAge(commit.authorTime)} · {dateTime(commit.authorTime)}
      </p>
      {commit.commitTime !== commit.authorTime && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">committed {dateTime(commit.commitTime)}</p>
      )}

      <dl className="mt-4 grid grid-cols-[4.5rem_1fr] items-baseline gap-x-2 gap-y-1.5 text-sm">
        <Field label="Parents">
          {parents.map(commitLink)}
          {commit.boundary && <Note>history before this is not in this shallow clone</Note>}
          {unloadedParents > 0 && <Note>{unloadedParents === 1 ? 'parent' : 'parents'} older than the loaded commits</Note>}
          {parents.length === 0 && !commit.boundary && unloadedParents === 0 && <Note>none (first commit)</Note>}
        </Field>
        <Field label="Children">{children.length > 0 ? children.map(commitLink) : <Note>none</Note>}</Field>
        {refs.length > 0 && (
          <Field label="Refs">
            {refs.map((ref) => (
              <span key={`${ref.kind}:${ref.name}`} className="mr-2 text-xs font-medium">
                {ref.name}
                {ref.kind === 'tag' && <span className="text-zinc-500"> (tag)</span>}
              </span>
            ))}
          </Field>
        )}
        {line && (
          <Field label="Line">
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span className="size-2.5 rounded-full" style={{ background: `var(--lane-${line.color})` }} />
              {line.name}
              {line.kind === 'merged' && <span className="text-zinc-500">(merged, branch deleted)</span>}
            </span>
          </Field>
        )}
      </dl>

      <div className="mt-6 space-y-2 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <p>Full message, changed files and diffs arrive in M2.</p>
        <p>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> or <Kbd>j</Kbd> <Kbd>k</Kbd> move · <Kbd>[</Kbd> <Kbd>]</Kbd> parent / child · hold{' '}
          <Kbd>Alt</Kbd> while hovering for ancestors · click a branch badge to focus it, <Kbd>Esc</Kbd> to clear
        </p>
        <p>
          Row {numberFormat.format(row + 1)} of {numberFormat.format(model.count)}
        </p>
      </div>
    </aside>
  );
}

const PANEL = 'w-[22rem] shrink-0 overflow-y-auto border-l border-zinc-200 p-4 dark:border-zinc-800';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">{children}</dd>
    </>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <span className="text-xs text-zinc-500 dark:text-zinc-400">{children}</span>;
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-300 px-1 font-sans text-[10px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
      {children}
    </kbd>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
