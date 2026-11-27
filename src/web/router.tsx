import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';

import { Centered, ErrorScreen } from './components/Screens.tsx';
import { HistoryView } from './features/history/HistoryView.tsx';
import { RepoLayout } from './features/repo/RepoLayout.tsx';
import { healthQuery, queryClient, repoInfoQuery, reposQuery } from './lib/queries.ts';
import { parseSearch, stringifySearch, validateHistorySearch } from './lib/search.ts';

export type { HistorySearch } from './lib/search.ts';

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
  parseSearch,
  stringifySearch,
  defaultPreload: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
