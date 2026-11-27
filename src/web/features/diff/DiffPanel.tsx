import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { DIFF_AUTOLOAD_MAX_LINES, type ChangedFile, type CommitDetails, type CompareWith, type FileDiff } from '../../../shared/api.ts';
import { errorMessage } from '../../components/Screens.tsx';
import { cx } from '../../lib/cx.ts';
import { fileSize, numberFormat, shortSha } from '../../lib/format.ts';
import { diffQuery } from '../../lib/queries.ts';
import { CompareTabs } from '../details/CompareTabs.tsx';
import { CopyButton } from '../details/DetailsPanel.tsx';
import { FileList, LineCounts, StatusLetter, visiblePath } from '../details/FileList.tsx';
import type { LoadedGraph } from '../history/state.ts';
import { DiffLines, useFocusOnChange } from './DiffLines.tsx';
import { useDiffMode, type DiffMode } from './mode.ts';

interface DiffPanelProps {
  repoId: string;
  graph: LoadedGraph;
  row: number;
  compare: CompareWith;
  details: UseQueryResult<CommitDetails>;
  /** The file whose diff is open. */
  path: string;
  ignoreWhitespace: boolean;
  onClose(): void;
  onOpenFile(path: string, replace?: boolean): void;
  onCompare(compare: CompareWith): void;
  onIgnoreWhitespace(ignore: boolean): void;
}

/** PLAN §4: clicking a file widens the right panel into a full diff view; Esc returns. */
export function DiffPanel(props: DiffPanelProps) {
  const { repoId, graph, row, compare, details, path, ignoreWhitespace, onClose, onOpenFile, onCompare, onIgnoreWhitespace } = props;
  const { model, analysis } = graph;
  const commit = model.commits[row]!;
  const data = details.data?.sha === commit.sha ? details.data : undefined;
  const files = data?.compare?.files ?? null;
  const file = files?.find((f) => f.path === path);
  const [mode, setMode] = useDiffMode();

  // Another commit was selected that doesn't change this file: show its first file instead.
  const first = files?.[0]?.path;
  useEffect(() => {
    if (files && !file && first !== undefined) onOpenFile(first, true);
  }, [files, file, first, onOpenFile]);

  return (
    <section aria-label="Diff" className="flex min-w-0 flex-1 flex-col border-l border-zinc-200 dark:border-zinc-800">
      <header className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-zinc-200 px-2 py-1 text-xs dark:border-zinc-800">
        <button
          type="button"
          className="shrink-0 rounded px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          title="Back to the commit details (Esc)"
          onClick={onClose}
        >
          ← Details
        </button>
        <code className="shrink-0 font-mono text-zinc-500 dark:text-zinc-400">{shortSha(commit.sha)}</code>
        <span className="min-w-24 flex-1 truncate font-medium" title={commit.subject}>
          {commit.subject}
        </span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <CompareTabs model={model} lines={analysis.lines} row={row} value={compare} onChange={onCompare} />
          <ModeToggle mode={compare === 'cc' ? 'unified' : mode} onChange={setMode} disabled={compare === 'cc'} />
          <label className="flex items-center gap-1.5 whitespace-nowrap" title="Ignore changes in whitespace (git diff -w)">
            <input type="checkbox" checked={ignoreWhitespace} onChange={(event) => onIgnoreWhitespace(event.target.checked)} />
            Ignore whitespace
          </label>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Changed files" className="w-[clamp(10rem,22%,16rem)] shrink-0 overflow-y-auto border-r border-zinc-200 p-2 dark:border-zinc-800">
          {files ? <FileList files={files} selected={path} onOpen={(next) => onOpenFile(next)} /> : <Notice>{details.error ? errorMessage(details.error) : 'Loading…'}</Notice>}
          <p className="mt-4 px-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <kbd>j</kbd> / <kbd>k</kbd> next / previous file · <kbd>[</kbd> <kbd>]</kbd> parent / child commit · <kbd>Esc</kbd> back
          </p>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          {file ? (
            <FileDiffView
              key={`${commit.sha}:${compare}:${file.path}`}
              repoId={repoId}
              sha={commit.sha}
              compare={compare}
              file={file}
              ignoreWhitespace={ignoreWhitespace}
              mode={compare === 'cc' ? 'unified' : mode}
            />
          ) : (
            <Notice>
              {data && !data.compare
                ? 'This commit’s parents aren’t in this shallow clone, so its changes can’t be shown.'
                : files?.length === 0
                  ? compare === 'cc'
                    ? 'No conflict resolutions: every change came from one of the parents.'
                    : 'This commit changes no files.'
                  : 'Loading…'}
            </Notice>
          )}
        </div>
      </div>
    </section>
  );
}

function ModeToggle({ mode, onChange, disabled }: { mode: DiffMode; onChange(mode: DiffMode): void; disabled: boolean }) {
  return (
    <div
      role="group"
      aria-label="Diff layout"
      className="flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-700"
      title={disabled ? 'Conflict resolutions are shown unified' : undefined}
    >
      {(['split', 'unified'] as const).map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          aria-pressed={mode === value}
          className={cx(
            'px-2 py-0.5 disabled:opacity-50',
            mode === value ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
          )}
          onClick={() => onChange(value)}
        >
          {value === 'split' ? 'Split' : 'Unified'}
        </button>
      ))}
    </div>
  );
}

interface FileDiffViewProps {
  repoId: string;
  sha: string;
  compare: CompareWith;
  file: ChangedFile;
  ignoreWhitespace: boolean;
  mode: DiffMode;
}

function FileDiffView({ repoId, sha, compare, file, ignoreWhitespace, mode }: FileDiffViewProps) {
  const changedLines = (file.additions ?? 0) + (file.deletions ?? 0);
  const large = changedLines > DIFF_AUTOLOAD_MAX_LINES;
  const [loadAnyway, setLoadAnyway] = useState(false);
  const enabled = !file.binary && (!large || loadAnyway);
  const query = useQuery({ ...diffQuery(repoId, sha, compare, file.path, ignoreWhitespace), enabled });
  const scrollRef = useRef<HTMLDivElement>(null);
  useFocusOnChange(scrollRef, `${sha}:${file.path}`, query.data !== undefined);

  let body: ReactNode;
  if (file.binary) {
    body = (
      <Notice>
        Binary file — not shown.
        {(file.oldSize !== undefined || file.newSize !== undefined) && (
          <span className="block mt-1">
            {file.oldSize !== undefined ? fileSize(file.oldSize) : 'none'} → {file.newSize !== undefined ? fileSize(file.newSize) : 'deleted'}
          </span>
        )}
      </Notice>
    );
  } else if (large && !loadAnyway) {
    body = (
      <Notice>
        Large diff: {numberFormat.format(changedLines)} changed lines aren’t shown automatically.
        <button
          type="button"
          className="mt-2 block rounded border border-zinc-300 px-2 py-1 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          onClick={() => setLoadAnyway(true)}
        >
          Load diff
        </button>
      </Notice>
    );
  } else if (query.error) {
    body = <Notice>Couldn’t load the diff: {errorMessage(query.error)}</Notice>;
  } else if (!query.data) {
    body = <Notice>Loading diff…</Notice>;
  } else if (query.data.binary) {
    body = <Notice>Binary file — not shown.</Notice>;
  } else if (!hasChanges(query.data)) {
    body = <Notice>{emptyDiffMessage(file, ignoreWhitespace)}</Notice>;
  } else {
    body = <DiffLines diff={query.data} mode={mode} cacheKey={[repoId, sha, String(compare), file.path, ignoreWhitespace]} scrollRef={scrollRef} />;
  }

  return (
    <>
      <FileHeader file={file} />
      {body}
    </>
  );
}

/** Whether any line is added or removed (in any marker column, for combined diffs). */
function hasChanges(diff: FileDiff): boolean {
  return diff.hunks.some((hunk) => hunk.lines.some((line) => !line.startsWith('\\') && /[+-]/.test(line.slice(0, diff.columns))));
}

function emptyDiffMessage(file: ChangedFile, ignoreWhitespace: boolean): string {
  if (file.oldMode !== file.newMode && file.oldMode !== '000000' && file.newMode !== '000000') {
    return `Only the file mode changed: ${file.oldMode} → ${file.newMode}${file.newMode === '100755' ? ' (executable)' : ''}.`;
  }
  if (file.status === 'renamed' || file.status === 'copied') return `${file.status === 'renamed' ? 'Renamed' : 'Copied'} without changes.`;
  if (ignoreWhitespace) return 'No changes when whitespace is ignored.';
  if (file.status === 'added') return 'Empty file added.';
  if (file.status === 'deleted') return 'Empty file deleted.';
  return 'No changes to show.';
}

const MODE_NAMES: Record<string, string> = { '120000': 'symbolic link', '160000': 'submodule', '100755': 'executable' };

function FileHeader({ file }: { file: ChangedFile }) {
  const kind = MODE_NAMES[file.newMode] ?? MODE_NAMES[file.oldMode];
  const modeChanged = file.oldMode !== file.newMode && file.oldMode !== '000000' && file.newMode !== '000000';
  return (
    <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-zinc-200 px-3 py-1 text-sm dark:border-zinc-800">
      <StatusLetter status={file.status} />
      <h3 className="min-w-0 truncate font-mono text-xs font-semibold" title={file.path}>
        {file.oldPath !== undefined && file.oldPath !== file.path && (
          <span className="font-normal text-zinc-500 dark:text-zinc-400">{visiblePath(file.oldPath)} → </span>
        )}
        {visiblePath(file.path)}
      </h3>
      {file.similarity !== undefined && <span className="text-xs text-zinc-500 dark:text-zinc-400">{file.similarity}% similar</span>}
      {kind && <span className="rounded bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{kind}</span>}
      {modeChanged && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          mode {file.oldMode} → {file.newMode}
        </span>
      )}
      <LineCounts file={file} className="ml-auto" />
      <CopyButton text={file.path} label="Copy path" />
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">{children}</div>;
}
