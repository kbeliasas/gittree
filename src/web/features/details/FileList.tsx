import { useState } from 'react';

import type { ChangedFile, FileStatus } from '../../../shared/api.ts';
import { cx } from '../../lib/cx.ts';
import { numberFormat } from '../../lib/format.ts';

const STATUS: Record<FileStatus, { letter: string; label: string; className: string }> = {
  added: { letter: 'A', label: 'added', className: 'text-emerald-700 dark:text-emerald-400' },
  modified: { letter: 'M', label: 'modified', className: 'text-amber-700 dark:text-amber-400' },
  deleted: { letter: 'D', label: 'deleted', className: 'text-rose-700 dark:text-rose-400' },
  renamed: { letter: 'R', label: 'renamed', className: 'text-violet-700 dark:text-violet-400' },
  copied: { letter: 'C', label: 'copied', className: 'text-sky-700 dark:text-sky-400' },
  typechange: { letter: 'T', label: 'type changed', className: 'text-zinc-600 dark:text-zinc-300' },
  unmerged: { letter: 'U', label: 'unmerged', className: 'text-zinc-600 dark:text-zinc-300' },
  unknown: { letter: '?', label: 'changed', className: 'text-zinc-600 dark:text-zinc-300' },
};

export function StatusLetter({ status }: { status: FileStatus }) {
  const { letter, label, className } = STATUS[status];
  return (
    <span className={cx('w-3 shrink-0 text-center font-mono text-xs font-semibold', className)} title={label} aria-label={label}>
      {letter}
    </span>
  );
}

/** "+40 −2", "binary", or nothing for conflict-resolution lists (which have no counts). */
export function LineCounts({ file, className }: { file: ChangedFile; className?: string }) {
  if (file.binary) return <span className={cx('text-xs text-zinc-500 dark:text-zinc-400', className)}>binary</span>;
  if (file.additions === null || file.deletions === null) return null;
  return (
    <span className={cx('shrink-0 font-mono text-xs tabular-nums', className)}>
      {file.additions > 0 && <span className="text-emerald-700 dark:text-emerald-400">+{numberFormat.format(file.additions)}</span>}
      {file.additions > 0 && file.deletions > 0 && ' '}
      {file.deletions > 0 && <span className="text-rose-700 dark:text-rose-400">−{numberFormat.format(file.deletions)}</span>}
    </span>
  );
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Shown in the list instead of a file's real name: line breaks and tabs made visible. */
export function visiblePath(path: string): string {
  return path.replace(/\n/g, '↵').replace(/\t/g, '⇥');
}

/** Files above this are listed after a click, so huge commits don't stall the panel. */
const SHOWN_AT_FIRST = 500;

interface FileListProps {
  files: readonly ChangedFile[];
  /** The file whose diff is open. */
  selected?: string;
  onOpen(path: string): void;
}

/** PLAN §8: changed files grouped by folder, with status and +/−. */
export function FileList({ files, selected, onOpen }: FileListProps) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? files : files.slice(0, SHOWN_AT_FIRST);
  const groups: Array<{ folder: string; files: ChangedFile[] }> = [];
  for (const file of shown) {
    const folder = dirname(file.path);
    const group = groups.at(-1);
    if (group?.folder === folder) group.files.push(file);
    else groups.push({ folder, files: [file] });
  }

  return (
    <div className="text-sm">
      {groups.map((group, g) => (
        <div key={`${g}:${group.folder}`} className="mt-1 first:mt-0">
          {group.folder !== '' && (
            <div className="truncate px-1 pt-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400" title={group.folder}>
              {visiblePath(group.folder)}/
            </div>
          )}
          <ul>
            {group.files.map((file) => {
              const moved = file.oldPath !== undefined && file.oldPath !== file.path;
              const isSelected = file.path === selected;
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    data-path={file.path}
                    aria-current={isSelected ? 'true' : undefined}
                    title={moved ? `${file.oldPath} → ${file.path}` : file.path}
                    className={cx(
                      'flex w-full items-center gap-2 rounded px-1 py-0.5 text-left',
                      isSelected ? 'bg-[var(--selected-bg)]' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/70',
                    )}
                    onClick={() => onOpen(file.path)}
                  >
                    <StatusLetter status={file.status} />
                    <span className="min-w-0 flex-1 truncate">
                      {visiblePath(basename(file.path))}
                      {moved && (
                        <span className="ml-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                          ← {visiblePath(dirname(file.oldPath!) === dirname(file.path) ? basename(file.oldPath!) : file.oldPath!)}
                        </span>
                      )}
                    </span>
                    <LineCounts file={file} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {shown.length < files.length && (
        <button type="button" className="mt-2 px-1 text-xs text-sky-700 hover:underline dark:text-sky-300" onClick={() => setShowAll(true)}>
          Show all {numberFormat.format(files.length)} files
        </button>
      )}
    </div>
  );
}
