import type { CSSProperties, MouseEvent } from 'react';

import type { GraphRef } from '../../../shared/api.ts';
import type { Lines } from '../../graph/lines.ts';
import { cx } from '../../lib/cx.ts';

export interface Badge {
  key: string;
  label: string;
  kind: 'branch' | 'remote' | 'tag' | 'head';
  /** The ref a click acts on (branches and remote branches). */
  ref?: GraphRef;
  title: string;
  color: number;
  isHead: boolean;
  isDefault: boolean;
}

/**
 * Badges for the refs at one commit: a local branch and the remote branch it
 * tracks share one badge; HEAD's branch comes first, then the default branch,
 * other branches, remote branches and tags.
 */
export function badgesFor(
  refs: readonly GraphRef[],
  lines: Lines,
  options: { headBranch: string | null; detachedHead: boolean; defaultBranch: string | null },
): Badge[] {
  const colorOf = (name: string) => lines.list[lines.byRef.get(name) ?? -1]?.color ?? 0;
  const remotes = new Map(refs.filter((r) => r.kind === 'remote').map((r) => [r.name, r]));
  const badges: Badge[] = [];

  if (options.detachedHead) {
    badges.push({ key: 'HEAD', label: 'HEAD', kind: 'head', title: 'HEAD (detached)', color: 0, isHead: true, isDefault: false });
  }
  for (const ref of refs.filter((r) => r.kind === 'local')) {
    const twinName = ref.upstream ?? `origin/${ref.name}`;
    const twin = remotes.get(twinName);
    if (twin) remotes.delete(twinName);
    const isHead = ref.name === options.headBranch;
    const parts = [ref.name, twin && `also ${twin.name}`, ref.upstreamGone && `upstream ${ref.upstream} is gone`, isHead && 'checked out'];
    badges.push({
      key: ref.name,
      label: twin ? `${ref.name} ⇅` : ref.name,
      kind: 'branch',
      ref,
      title: parts.filter(Boolean).join(' · '),
      color: colorOf(ref.name),
      isHead,
      isDefault: ref.name === options.defaultBranch,
    });
  }
  for (const ref of remotes.values()) {
    badges.push({
      key: ref.name,
      label: ref.name,
      kind: 'remote',
      ref,
      title: `${ref.name} (remote branch)`,
      color: colorOf(ref.name),
      isHead: false,
      isDefault: ref.name === options.defaultBranch,
    });
  }
  for (const ref of refs.filter((r) => r.kind === 'tag')) {
    badges.push({ key: `tag:${ref.name}`, label: ref.name, kind: 'tag', title: `tag ${ref.name}`, color: colorOf(ref.name), isHead: false, isDefault: false });
  }

  const rank = (b: Badge) => (b.kind === 'head' || b.isHead ? 0 : b.isDefault ? 1 : b.kind === 'branch' ? 2 : b.kind === 'remote' ? 3 : 4);
  return badges.sort((a, b) => rank(a) - rank(b));
}

const VISIBLE = 3;

interface RefBadgesProps {
  badges: readonly Badge[];
  focused: string | null;
  /** A branch badge was clicked: focus it (or unfocus it when it already is). */
  onFocus(ref: GraphRef): void;
}

export function RefBadges({ badges, focused, onFocus }: RefBadgesProps) {
  if (badges.length === 0) return null;
  const shown = badges.slice(0, VISIBLE);
  const hidden = badges.slice(VISIBLE);

  return (
    <span className="flex shrink-0 items-center gap-1">
      {shown.map((badge) => {
        const focusable = (badge.kind === 'branch' || badge.kind === 'remote') && !badge.isDefault && badge.ref;
        const isFocused = focusable && badge.ref?.name === focused;
        const style = { '--c': `var(--lane-${badge.color})` } as CSSProperties;
        const className = cx(
          'max-w-56 truncate rounded px-1.5 text-xs leading-5 font-medium',
          badge.kind === 'tag' && 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
          badge.kind === 'head' && 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900',
          badge.kind === 'remote' && 'border border-dashed border-[var(--c)] leading-[18px]',
          badge.kind === 'branch' &&
            (badge.isHead
              ? 'bg-[var(--c)] text-white dark:text-zinc-950'
              : 'bg-[color-mix(in_oklab,var(--c)_16%,transparent)] text-zinc-900 dark:text-zinc-100'),
          isFocused && 'ring-2 ring-[var(--c)] ring-offset-1 ring-offset-[var(--row-bg)]',
          focusable && 'cursor-pointer hover:brightness-110',
        );
        if (!focusable) {
          return (
            <span key={badge.key} className={className} style={style} title={badge.title} data-badge={badge.key}>
              {badge.kind === 'tag' && <span aria-hidden="true">⌂ </span>}
              {badge.label}
            </span>
          );
        }
        return (
          <button
            key={badge.key}
            type="button"
            className={className}
            style={style}
            title={`${badge.title} — click to ${isFocused ? 'stop focusing' : 'focus this branch'}`}
            aria-pressed={Boolean(isFocused)}
            data-badge={badge.key}
            onClick={(event: MouseEvent) => {
              event.stopPropagation();
              onFocus(badge.ref!);
            }}
          >
            {badge.label}
          </button>
        );
      })}
      {hidden.length > 0 && (
        <span className="rounded px-1 text-xs text-zinc-500 dark:text-zinc-400" title={hidden.map((b) => b.title).join('\n')}>
          +{hidden.length}
        </span>
      )}
    </span>
  );
}
