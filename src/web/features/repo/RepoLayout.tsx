import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi, Link, Outlet } from '@tanstack/react-router';

import { healthQuery, repoInfoQuery } from '../../lib/queries.ts';

const route = getRouteApi('/r/$repoId');

const LATER_VIEWS = [
  { name: 'Branches', milestone: 'M5' },
  { name: 'Files', milestone: 'M6' },
  { name: 'Stats', milestone: 'M7' },
  { name: 'Settings', milestone: 'M4' },
] as const;

/** Header, view navigation and the active view. */
export function RepoLayout() {
  const { repoId } = route.useParams();
  const { data: health } = useSuspenseQuery(healthQuery());
  const { data: repo } = useSuspenseQuery(repoInfoQuery(repoId));
  const flags = [repo.bare && 'bare', repo.shallow && 'shallow clone'].filter(Boolean).join(' · ');

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-zinc-200 px-4 text-sm dark:border-zinc-800">
        <span className="font-semibold tracking-tight">gittree</span>
        <span className="text-zinc-400">/</span>
        <h1 className="font-medium" title={repo.path}>
          {repo.name}
        </h1>
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-200">
          {repo.head.branch ?? 'detached HEAD'}
        </span>
        {flags && <span className="text-xs text-zinc-500 dark:text-zinc-400">{flags}</span>}
        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
          v{health.version} · git {health.git.version}
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Views" className="w-36 shrink-0 border-r border-zinc-200 p-2 dark:border-zinc-800">
          <ul className="space-y-0.5 text-sm">
            <li>
              <Link
                to="/r/$repoId/history"
                params={{ repoId }}
                className="block rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                activeProps={{ className: 'bg-zinc-100 font-medium dark:bg-zinc-900', 'aria-current': 'page' }}
              >
                History
              </Link>
            </li>
            {LATER_VIEWS.map((view) => (
              <li
                key={view.name}
                aria-disabled="true"
                className="flex items-center justify-between rounded px-2 py-1.5 text-zinc-400 dark:text-zinc-500"
              >
                {view.name}
                <span className="text-[10px] uppercase tracking-wide">{view.milestone}</span>
              </li>
            ))}
          </ul>
        </nav>
        <main className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
