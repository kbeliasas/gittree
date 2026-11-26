import type { ReactNode } from 'react';

import { ApiError, SignedOutError } from '../lib/api.ts';

export function Centered({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md">
        <h1 className="text-lg font-semibold">{title}</h1>
        {children && <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{children}</div>}
      </div>
    </main>
  );
}

export function SignedOut() {
  return (
    <Centered title="This tab isn’t signed in to gittree">
      gittree only answers the browser that opened the link printed in your terminal. Run{' '}
      <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">gittree</code>{' '}
      again to get a fresh link.
    </Centered>
  );
}

export function ErrorScreen({ error }: { error: unknown }) {
  if (error instanceof SignedOutError) return <SignedOut />;
  if (error instanceof ApiError && error.code === 'repo_not_found') {
    return (
      <Centered title="This repository isn’t open">
        The link points at a repository this gittree wasn’t started with. Run <code>gittree &lt;path&gt;</code> to open it.
      </Centered>
    );
  }
  return <Centered title="Something went wrong">{errorMessage(error)}</Centered>;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
