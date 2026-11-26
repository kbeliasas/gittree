import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';

import { GraphOrder } from '../shared/api.ts';
import { Centered, ErrorScreen } from './components/Screens.tsx';
import { HistoryView } from './features/history/HistoryView.tsx';
import { RepoLayout } from './features/repo/RepoLayout.tsx';
import { healthQuery, queryClient, repoInfoQuery, reposQuery } from './lib/queries.ts';

/**
 * PLAN §7: the URL holds the view state — repository, view, selected commit,
 * graph order, focused branch — so links are bookmarkable and Back/Forward
 * retrace your exploration.
 */
export interface HistorySearch {
  /** Selected commit (full or abbreviated hash); HEAD when absent. */
  sel?: string;
  /** Graph order; date order when absent. */
  order?: GraphOrder;
  /** Focused branch name. */
  focus?: string;
}

const HASH = /^[0-9a-f]{4,64}$/;

export function validateHistorySearch(search: Record<string, unknown>): HistorySearch {
  const result: HistorySearch = {};
  if (typeof search.sel === 'string' && HASH.test(search.sel)) result.sel = search.sel;
  if (search.order === 'topo') result.order = 'topo';
  if (typeof search.focus === 'string' && search.focus !== '' && search.focus.length <= 255) result.focus = search.focus;
  return result;
}

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
  errorComponent: ({ error }) => <ErrorScreen error={error} />,
  notFoundComponent: () => <Centered title="Page not found" />,
});

/** `/` opens the repository gittree was started with. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  loader: async ({ context }) => {
    const { repos } = await context.queryClient.ensureQueryData(reposQuery());
    const first = repos[0];
    if (first) throw redirect({ to: '/r/$repoId/history', params: { repoId: first.id }, replace: true });
  },
  component: () => <Centered title="No repository is open" />,
});

const repoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'r/$repoId',
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(healthQuery()),
      context.queryClient.ensureQueryData(repoInfoQuery(params.repoId)),
    ]),
  component: RepoLayout,
});

const repoIndexRoute = createRoute({
  getParentRoute: () => repoRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/r/$repoId/history', params, replace: true });
  },
});

const historyRoute = createRoute({
  getParentRoute: () => repoRoute,
  path: 'history',
  validateSearch: validateHistorySearch,
  component: HistoryView,
});

const routeTree = rootRoute.addChildren([indexRoute, repoRoute.addChildren([repoIndexRoute, historyRoute])]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  // Plain key=value search params: TanStack's JSON default would turn an all-digit hash into a number.
  parseSearch: (text) => Object.fromEntries(new URLSearchParams(text)),
  stringifySearch: (search) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const text = params.toString();
    return text === '' ? '' : `?${text}`;
  },
  defaultPreload: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
