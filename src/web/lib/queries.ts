import { QueryClient, queryOptions } from '@tanstack/react-query';

import { GraphPayload, HealthResponse, RepoInfo, ReposResponse, type GraphOrder } from '../../shared/api.ts';
import { ApiError, getJson, SignedOutError } from './api.ts';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Repository data changes only when refs move; the refresh banner (M4) will invalidate it.
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: (failures, error) =>
        failures < 1 && !(error instanceof SignedOutError) && !(error instanceof ApiError && error.status < 500),
    },
  },
});

export const healthQuery = () =>
  queryOptions({ queryKey: ['health'], queryFn: ({ signal }) => getJson('/api/health', HealthResponse, signal) });

export const reposQuery = () =>
  queryOptions({ queryKey: ['repos'], queryFn: ({ signal }) => getJson('/api/repos', ReposResponse, signal) });

export const repoInfoQuery = (repoId: string) =>
  queryOptions({
    queryKey: ['repo', repoId],
    queryFn: ({ signal }) => getJson(`/api/repos/${repoId}`, RepoInfo, signal),
  });

export const graphQuery = (repoId: string, order: GraphOrder) =>
  queryOptions({
    queryKey: ['graph', repoId, order],
    queryFn: ({ signal }) => getJson(`/api/repos/${repoId}/graph?order=${order}`, GraphPayload, signal),
    structuralSharing: false, // large, and replaced wholesale
  });
