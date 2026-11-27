import { QueryClient, queryOptions } from '@tanstack/react-query';

import {
  CommitDetails,
  FileDiff,
  GraphPayload,
  HealthResponse,
  MessagesPayload,
  RepoInfo,
  ReposResponse,
  SettingsResponse,
  TreePayload,
  type CompareWith,
  type GraphOrder,
} from '../../shared/api.ts';
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

/** Message bodies for search; the graph's snapshot in the key refetches them when refs move. */
export const messagesQuery = (repoId: string, order: GraphOrder, snapshot: string) =>
  queryOptions({
    queryKey: ['messages', repoId, order, snapshot],
    queryFn: ({ signal }) => getJson(`/api/repos/${repoId}/messages?order=${order}`, MessagesPayload, signal),
    structuralSharing: false, // large, and replaced wholesale
  });

/** Every file at a commit; `path:` suggestions use HEAD's. */
export const treeQuery = (repoId: string, at: string) =>
  queryOptions({
    queryKey: ['tree', repoId, at],
    queryFn: ({ signal }) => getJson(`/api/repos/${repoId}/tree?at=${at}`, TreePayload, signal),
    structuralSharing: false,
  });

/** Read from the config file on every request, so a page reload picks up hand edits (M4 adds the Settings view). */
export const settingsQuery = () =>
  queryOptions({ queryKey: ['settings'], queryFn: ({ signal }) => getJson('/api/settings', SettingsResponse, signal) });

/** Commits never change, so details and diffs stay cached for the session. */
export const commitQuery = (repoId: string, sha: string, compare: CompareWith) =>
  queryOptions({
    queryKey: ['commit', repoId, sha, String(compare)],
    queryFn: ({ signal }) => getJson(`/api/repos/${repoId}/commits/${sha}?parent=${compare}`, CommitDetails, signal),
  });

export const diffQuery = (repoId: string, sha: string, compare: CompareWith, path: string, ignoreWhitespace: boolean) =>
  queryOptions({
    queryKey: ['diff', repoId, sha, String(compare), path, ignoreWhitespace],
    queryFn: ({ signal }) => {
      const query = new URLSearchParams({ sha, parent: String(compare), path, ws: ignoreWhitespace ? '1' : '0' });
      return getJson(`/api/repos/${repoId}/diff?${query}`, FileDiff, signal);
    },
    structuralSharing: false, // can be large, and replaced wholesale
  });
