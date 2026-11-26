import { useEffect, useState, type ReactNode } from 'react';

import { HealthResponse, RepoInfo, ReposResponse } from '../shared/api.ts';
import { getJson, SignedOutError } from './lib/api.ts';

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; health: HealthResponse; repos: RepoInfo[] };

const VIEWS = [
  { name: 'History', milestone: 'M1' },
  { name: 'Branches', milestone: 'M5' },
  { name: 'Files', milestone: 'M6' },
  { name: 'Stats', milestone: 'M7' },
  { name: 'Settings', milestone: 'M4' },
] as const;

const numberFormat = new Intl.NumberFormat('en-US');

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      const [health, { repos }] = await Promise.all([
        getJson('/api/health', HealthResponse, signal),
        getJson('/api/repos', ReposResponse, signal),
      ]);
      const infos = await Promise.all(repos.map((repo) => getJson(`/api/repos/${repo.id}`, RepoInfo, signal)));
      setState({ kind: 'ready', health, repos: infos });
    })().catch((error: unknown) => {
      if (signal.aborted) return;
      if (error instanceof SignedOutError) setState({ kind: 'signed-out' });
      else setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    });
    return () => controller.abort();
  }, []);

  switch (state.kind) {
    case 'loading':
      return <Centered title="Loading…" />;
    case 'signed-out':
      return (
        <Centered title="This tab isn’t signed in to gittree">
          gittree only answers the browser that opened the link printed in your terminal. Run{' '}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
            gittree
          </code>{' '}
          again to get a fresh link.
        </Centered>
      );
    case 'error':
      return <Centered title="Something went wrong">{state.message}</Centered>;
    case 'ready':
      return <Shell health={state.health} repos={state.repos} />;
  }
}

function Shell({ health, repos }: { health: HealthResponse; repos: RepoInfo[] }) {
  const repo = repos[0];
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
        <span className="font-semibold tracking-tight">gittree</span>
        {repo && (
          <>
            <span className="text-zinc-400">/</span>
            <span className="font-medium">{repo.name}</span>
            <HeadBadge repo={repo} />
          </>
        )}
        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
          v{health.version} · git {health.git.version}
        </span>
      </header>
      <div className="flex flex-1">
        <nav aria-label="Views" className="w-40 shrink-0 border-r border-zinc-200 p-2 dark:border-zinc-800">
          <ul className="space-y-0.5">
            {VIEWS.map((view) => (
              <li
                key={view.name}
                aria-disabled="true"
                className="flex items-center justify-between rounded px-2 py-1.5 text-sm text-zinc-400 dark:text-zinc-500"
              >
                {view.name}
                <span className="text-[10px] uppercase tracking-wide">{view.milestone}</span>
              </li>
            ))}
          </ul>
        </nav>
        <main className="flex-1 p-6">
          {repo ? <RepoCard repo={repo} /> : <p className="text-sm text-zinc-500">No repository is open.</p>}
        </main>
      </div>
    </div>
  );
}

function HeadBadge({ repo }: { repo: RepoInfo }) {
  const label = repo.head.branch ?? 'detached HEAD';
  return (
    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-200">
      {label}
    </span>
  );
}

function RepoCard({ repo }: { repo: RepoInfo }) {
  const flags = [repo.bare && 'bare', repo.shallow && 'shallow clone'].filter(Boolean).join(', ');
  return (
    <section className="max-w-2xl rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
      <h1 className="text-lg font-semibold">{repo.name}</h1>
      <p className="mt-0.5 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">{repo.path}</p>
      <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
        <dt className="text-zinc-500 dark:text-zinc-400">HEAD</dt>
        <dd>
          {repo.head.branch ?? 'detached'}
          {repo.head.sha ? (
            <span className="ml-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">{repo.head.sha.slice(0, 7)}</span>
          ) : (
            <span className="ml-2 text-zinc-500 dark:text-zinc-400">no commits yet</span>
          )}
        </dd>
        <dt className="text-zinc-500 dark:text-zinc-400">Commits</dt>
        <dd>{numberFormat.format(repo.commitCount)}</dd>
        {flags && (
          <>
            <dt className="text-zinc-500 dark:text-zinc-400">Repository</dt>
            <dd>{flags}</dd>
          </>
        )}
      </dl>
      <p className="mt-5 border-t border-zinc-200 pt-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Connected. The history graph arrives in milestone M1.
      </p>
    </section>
  );
}

function Centered({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md">
        <h1 className="text-lg font-semibold">{title}</h1>
        {children && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{children}</p>}
      </div>
    </main>
  );
}
