import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import type { ChangedFile, CommitDetails, CompareWith, GraphRef, Signature } from '../../../shared/api.ts';
import { errorMessage } from '../../components/Screens.tsx';
import { childrenByLine } from '../../graph/model.ts';
import { containedIn, type MergedCommits } from '../../graph/reach.ts';
import { cx } from '../../lib/cx.ts';
import { dateTime, duration, longAge, numberFormat, plural, shortSha, zonedTime } from '../../lib/format.ts';
import { jiraKeys, jiraMatcher, jiraUrl, linkify, type JiraMatcher } from '../../lib/jira.ts';
import { repoInfoQuery, settingsQuery } from '../../lib/queries.ts';
import { useHover, type Emphasis, type LoadedGraph } from '../history/state.ts';
import { CompareTabs } from './CompareTabs.tsx';
import { FileList } from './FileList.tsx';

interface DetailsPanelProps {
  repoId: string;
  graph: LoadedGraph;
  row: number;
  compare: CompareWith;
  details: UseQueryResult<CommitDetails>;
  /** For merges: what they brought in (also marked in the list). */
  merged: MergedCommits | null;
  onSelect(row: number): void;
  onFocusRef(ref: GraphRef): void;
  onCompare(compare: CompareWith): void;
  onOpenFile(path: string): void;
}

/** PLAN §8 commit details: message, people, relations, Jira links and the changed files. */
export function DetailsPanel(props: DetailsPanelProps) {
  const { repoId, graph, row, compare, details, merged, onSelect, onFocusRef, onCompare, onOpenFile } = props;
  const { model, analysis } = graph;
  const commit = model.commits[row];
  const settings = useQuery(settingsQuery()).data;
  const web = useQuery(repoInfoQuery(repoId)).data?.web ?? null;
  const matcher = useMemo(() => jiraMatcher(settings?.jira.projectKeys ?? []), [settings]);
  const jiraBase = settings?.jira.baseUrl ?? null;

  // Nothing in this panel may keep the graph lit once it shows another commit.
  useEffect(() => () => useHover.getState().setPanel(null), [row]);

  if (!commit) return <aside className={PANEL} aria-label="Selected commit" />;

  const data = details.data?.sha === commit.sha ? details.data : undefined;
  const graphAuthor = model.payload.authors[commit.author];
  const author: Signature = data?.author ?? { name: graphAuthor?.name ?? '', email: graphAuthor?.email ?? '', time: commit.authorTime, tz: 0 };
  const message = data?.message ?? commit.subject;
  const { title, body } = splitMessage(message);

  const line = analysis.lines.list[analysis.lines.owner[row]!];
  const refsHere = model.refsAt.get(row) ?? [];
  const parents: number[] = [];
  let unloadedParents = 0;
  for (let k = model.parentStart[row]!; k < model.parentStart[row + 1]!; k++) {
    const parent = model.parentIdx[k]!;
    if (parent < model.count) parents.push(parent);
    else unloadedParents++;
  }
  const children = childrenByLine(model, analysis.layout.lane, row);
  const mergedNames = mergedLineNames(graph, row);
  const keys = jiraKeys([message, line?.name ?? '', ...mergedNames], matcher);

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
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-600 select-all dark:text-zinc-400" title={commit.sha}>
          {commit.sha}
        </code>
        <CopyButton text={commit.sha} />
        {web && (
          <a
            className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            href={web.commitUrl.replace('{sha}', commit.sha)}
            target="_blank"
            rel="noreferrer noopener"
            title={`Open this commit on ${web.host}`}
          >
            {web.host} ↗
          </a>
        )}
      </div>

      <h2 className="mt-2 text-sm leading-snug font-semibold break-words">
        <Linked text={title} matcher={matcher} jiraBase={jiraBase} />
      </h2>
      {body !== '' && (
        <div className="mt-2 text-sm break-words whitespace-pre-wrap text-zinc-700 dark:text-zinc-300" data-message-body>
          <Linked text={body} matcher={matcher} jiraBase={jiraBase} />
        </div>
      )}
      {details.isPending && !data && <p className="mt-2 h-4 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" aria-hidden="true" />}

      <People author={author} committer={data?.committer} exactAuthor={data !== undefined} />

      <dl className="mt-4 grid grid-cols-[4.5rem_1fr] items-baseline gap-x-2 gap-y-1.5 text-sm">
        <Field label="Parents">
          {parents.map(commitLink)}
          {commit.boundary && <Note>history before this is not in this shallow clone</Note>}
          {unloadedParents > 0 && <Note>{unloadedParents === 1 ? 'parent' : 'parents'} older than the loaded commits</Note>}
          {parents.length === 0 && !commit.boundary && unloadedParents === 0 && <Note>none (first commit)</Note>}
        </Field>
        <Field label="Children">{children.length > 0 ? children.map(commitLink) : <Note>none</Note>}</Field>
        {merged && merged.count > 0 && (
          <Field label="Merged">
            <MergedSummary row={row} merged={merged} names={mergedNames} mergeTime={commit.commitTime} authorTime={model.commits[merged.oldest]?.authorTime} />
          </Field>
        )}
        {refsHere.length > 0 && (
          <Field label="Refs">
            {refsHere.map((ref) => (
              <span key={`${ref.kind}:${ref.name}`} className="mr-2 text-xs font-medium">
                {ref.name}
                {ref.kind === 'tag' && <span className="text-zinc-500"> (tag)</span>}
              </span>
            ))}
          </Field>
        )}
        <ContainedIn graph={graph} row={row} onFocusRef={onFocusRef} />
        {keys.length > 0 && (
          <Field label="Jira">
            {keys.map((key) => (
              <JiraKey key={key} jiraKey={key} jiraBase={jiraBase} configPath={settings?.path} />
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

      <section aria-label="Changed files" className="mt-5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Changed files{data?.compare ? ` (${numberFormat.format(data.compare.files.length)})` : ''}
          </h3>
          {data?.compare && <Totals files={data.compare.files} />}
        </div>
        {parents.length + unloadedParents > 1 && (
          <div className="mb-2">
            <CompareTabs model={model} lines={analysis.lines} row={row} value={compare} onChange={onCompare} />
          </div>
        )}
        <ChangedFiles details={details} data={data} compare={compare} onOpenFile={onOpenFile} />
      </section>

      <div className="mt-6 space-y-2 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <p>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> or <Kbd>j</Kbd> <Kbd>k</Kbd> move · <Kbd>[</Kbd> <Kbd>]</Kbd> parent / child · <Kbd>Enter</Kbd> first
          file’s diff · hold <Kbd>Alt</Kbd> while hovering for ancestors · click a branch badge to focus it, <Kbd>Esc</Kbd> to clear
        </p>
        <p>
          Row {numberFormat.format(row + 1)} of {numberFormat.format(model.count)}
        </p>
      </div>
    </aside>
  );
}

const PANEL = 'w-[26rem] shrink-0 overflow-y-auto border-l border-zinc-200 p-4 dark:border-zinc-800';

/** Git's subject is the first paragraph; the rest is the body. */
function splitMessage(message: string): { title: string; body: string } {
  const blank = message.search(/\n\s*\n/);
  if (blank === -1) return { title: message.replace(/\n/g, ' ').trim(), body: '' };
  return { title: message.slice(0, blank).replace(/\n/g, ' ').trim(), body: message.slice(blank).replace(/^\s*\n/, '').trimEnd() };
}

/** Names of the branch lines a merge's other parents belong to. */
function mergedLineNames({ model, analysis }: LoadedGraph, row: number): string[] {
  const names = new Set<string>();
  for (let k = model.parentStart[row]! + 1; k < model.parentStart[row + 1]!; k++) {
    const parent = model.parentIdx[k]!;
    const name = parent < model.count ? analysis.lines.list[analysis.lines.owner[parent]!]?.name : undefined;
    if (name) names.add(name);
  }
  return [...names];
}

function MergedSummary(props: { row: number; merged: MergedCommits; names: string[]; mergeTime: number; authorTime: number | undefined }) {
  const { row, merged, names, mergeTime, authorTime } = props;
  const emphasis = useMemo((): Emphasis => {
    const rows = merged.rows.slice();
    rows[row] = 1;
    return { kind: 'rows', rows, marks: new Map([[row, 'merge']]) };
  }, [merged, row]);
  const light = () => useHover.getState().setPanel(emphasis);
  const clear = () => useHover.getState().setPanel(null);
  const lifetime = authorTime === undefined ? null : duration(mergeTime - authorTime);

  return (
    <span
      tabIndex={0}
      data-merged-summary
      className="cursor-default rounded px-1 text-xs outline-offset-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      title="Hover to light up the merged commits in the graph"
      onPointerEnter={light}
      onPointerLeave={clear}
      onFocus={light}
      onBlur={clear}
    >
      {names.length > 0 && <strong className="font-semibold">{names.join(', ')}</strong>}
      {names.length > 0 && ': '}
      {merged.partial ? 'at least ' : ''}
      {plural(merged.count, 'commit')}
      {lifetime && ` over ${lifetime}`}
    </span>
  );
}

const SHOWN_REFS = 6;

/** Branches and tags whose history contains the commit (those pointing right at it are under Refs). */
function ContainedIn({ graph, row, onFocusRef }: { graph: LoadedGraph; row: number; onFocusRef(ref: GraphRef): void }) {
  const { model, analysis } = graph;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [row]);
  const refs = useMemo(() => {
    const offset = model.payload.page.offset;
    const { defaultBranch, head } = model.payload;
    const rank = (ref: GraphRef) =>
      ref.name === defaultBranch ? 0 : ref.name === head.branch ? 1 : ref.kind === 'local' ? 2 : ref.kind === 'remote' ? 3 : 4;
    return containedIn(model, row, model.payload.refs, offset)
      .filter((ref) => ref.commit - offset !== row)
      .sort((a, b) => rank(a) - rank(b) || a.commit - b.commit || a.name.localeCompare(b.name));
  }, [model, row]);
  if (refs.length === 0) return null;
  const shown = expanded ? refs : refs.slice(0, SHOWN_REFS);

  return (
    <Field label="In">
      {shown.map((ref) =>
        ref.kind === 'tag' ? (
          <span key={`tag:${ref.name}`} className="text-xs text-zinc-600 dark:text-zinc-300">
            ⌂ {ref.name}
          </span>
        ) : (
          <button
            key={`${ref.kind}:${ref.name}`}
            type="button"
            className="inline-flex items-center gap-1 rounded px-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title={`Focus ${ref.name}`}
            onClick={() => onFocusRef(ref)}
          >
            <span
              className="size-2 rounded-full"
              style={{ background: `var(--lane-${analysis.lines.list[analysis.lines.byRef.get(ref.name) ?? -1]?.color ?? 0})` } as CSSProperties}
            />
            {ref.name}
          </button>
        ),
      )}
      {refs.length > shown.length && (
        <button type="button" className="text-xs text-sky-700 hover:underline dark:text-sky-300" onClick={() => setExpanded(true)}>
          +{refs.length - shown.length} more
        </button>
      )}
    </Field>
  );
}

function People({ author, committer, exactAuthor }: { author: Signature; committer: Signature | undefined; exactAuthor: boolean }) {
  const differs =
    committer !== undefined && (committer.name !== author.name || committer.email !== author.email || committer.time !== author.time);
  return (
    <div className="mt-3 space-y-1 text-sm">
      <p>
        {author.name} <span className="text-zinc-500 dark:text-zinc-400">&lt;{author.email}&gt;</span>
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        authored {longAge(author.time)} ·{' '}
        <time dateTime={new Date(author.time * 1000).toISOString()} title={exactAuthor ? `${zonedTime(author.time, author.tz)} in the author’s time zone` : undefined}>
          {dateTime(author.time)}
        </time>
      </p>
      {differs && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400" data-committer>
          committed
          {(committer.name !== author.name || committer.email !== author.email) && (
            <>
              {' by '}
              <span className="text-zinc-700 dark:text-zinc-300">{committer.name}</span> &lt;{committer.email}&gt;
            </>
          )}{' '}
          {longAge(committer.time)} ·{' '}
          <time dateTime={new Date(committer.time * 1000).toISOString()} title={`${zonedTime(committer.time, committer.tz)} in the committer’s time zone`}>
            {dateTime(committer.time)}
          </time>
        </p>
      )}
    </div>
  );
}

function ChangedFiles(props: {
  details: UseQueryResult<CommitDetails>;
  data: CommitDetails | undefined;
  compare: CompareWith;
  onOpenFile(path: string): void;
}) {
  const { details, data, compare, onOpenFile } = props;
  if (!data) {
    if (details.error) return <Note>Couldn’t load the changes: {errorMessage(details.error)}</Note>;
    return <Note>Loading…</Note>;
  }
  if (!data.compare) return <Note>This commit’s parents aren’t in this shallow clone, so its changes can’t be shown.</Note>;
  if (data.compare.files.length === 0) {
    return <Note>{compare === 'cc' ? 'No conflict resolutions: every change came from one of the parents.' : 'No files changed.'}</Note>;
  }
  return <FileList files={data.compare.files} onOpen={onOpenFile} />;
}

function Totals({ files }: { files: readonly ChangedFile[] }) {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions ?? 0;
    deletions += file.deletions ?? 0;
  }
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className="font-mono text-xs tabular-nums">
      <span className="text-emerald-700 dark:text-emerald-400">+{numberFormat.format(additions)}</span>{' '}
      <span className="text-rose-700 dark:text-rose-400">−{numberFormat.format(deletions)}</span>
    </span>
  );
}

/** Message text with http(s) links and Jira keys (links when a Jira base URL is configured). */
function Linked({ text, matcher, jiraBase }: { text: string; matcher: JiraMatcher; jiraBase: string | null }) {
  const segments = useMemo(() => linkify(text, matcher), [text, matcher]);
  return (
    <>
      {segments.map((segment, i) => {
        if (!('kind' in segment)) return <span key={i}>{segment.text}</span>;
        const jiraKey = segment.kind === 'jira' ? segment.key : undefined;
        const href = segment.kind === 'url' ? segment.href : jiraBase && jiraKey ? jiraUrl(jiraBase, jiraKey) : null;
        if (!href) {
          return (
            <span key={i} className="font-medium" data-jira-key={jiraKey}>
              {segment.text}
            </span>
          );
        }
        return (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            data-jira-key={jiraKey}
            className="text-sky-700 underline decoration-sky-700/30 underline-offset-2 hover:decoration-sky-700 dark:text-sky-300 dark:decoration-sky-300/30"
          >
            {segment.text}
          </a>
        );
      })}
    </>
  );
}

function JiraKey({ jiraKey, jiraBase, configPath }: { jiraKey: string; jiraBase: string | null; configPath: string | undefined }) {
  const className = 'rounded bg-zinc-100 px-1.5 text-xs font-medium dark:bg-zinc-800';
  if (!jiraBase) {
    const hint = configPath ? `Set jira.baseUrl in ${configPath} to link Jira issues` : undefined;
    return (
      <span className={className} title={hint}>
        {jiraKey}
      </span>
    );
  }
  return (
    <a className={cx(className, 'text-sky-700 hover:underline dark:text-sky-300')} href={jiraUrl(jiraBase, jiraKey)} target="_blank" rel="noreferrer noopener">
      {jiraKey} ↗
    </a>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-0.5">{children}</dd>
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

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
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
      {copied ? 'Copied' : label}
    </button>
  );
}
