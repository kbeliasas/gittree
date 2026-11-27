import type { CompareWith } from '../../../shared/api.ts';
import type { GraphModel } from '../../graph/model.ts';
import type { Lines } from '../../graph/lines.ts';
import { cx } from '../../lib/cx.ts';

interface CompareTabsProps {
  model: GraphModel;
  lines: Lines;
  row: number;
  value: CompareWith;
  onChange(value: CompareWith): void;
}

/**
 * PLAN §8: a merge is compared with its first parent by default ("what this
 * merge brought in"), switchable per parent, or to its conflict resolutions.
 */
export function CompareTabs({ model, lines, row, value, onChange }: CompareTabsProps) {
  const parents: number[] = [];
  for (let k = model.parentStart[row]!; k < model.parentStart[row + 1]!; k++) parents.push(model.parentIdx[k]!);
  if (parents.length < 2) return null;

  const lineName = (parent: number) => (parent < model.count ? lines.list[lines.owner[parent]!]?.name : undefined);
  const tabs: Array<{ value: CompareWith; label: string; title: string }> = parents.map((parent, i) => ({
    value: i + 1,
    label: lineName(parent) ?? `parent ${i + 1}`,
    title: `Changes compared with parent ${i + 1}${lineName(parent) ? ` (${lineName(parent)})` : ''}${
      parent < model.count ? `: ${model.commits[parent]!.subject}` : ''
    }`,
  }));
  tabs.push({ value: 'cc', label: 'conflicts', title: 'What the merge itself changed: lines that differ from every parent (git --cc)' });

  return (
    <div role="group" aria-label="Compare with" className="flex min-w-0 items-center gap-1 text-xs">
      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">vs</span>
      <div className="flex min-w-0 overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
        {tabs.map((tab) => (
          <button
            key={String(tab.value)}
            type="button"
            aria-pressed={value === tab.value}
            title={tab.title}
            className={cx(
              'max-w-36 min-w-0 truncate border-l border-zinc-300 px-1.5 py-0.5 first:border-l-0 dark:border-zinc-700',
              value === tab.value ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
            )}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
