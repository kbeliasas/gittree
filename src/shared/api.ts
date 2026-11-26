import { z } from 'zod';

// Request and response shapes shared by the server (validation and
// serialization) and the web client (parsing). Each schema doubles as a type.

export const ApiErrorBody = z.object({
  error: z.string(),
  message: z.string(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const HealthResponse = z.object({
  ok: z.literal(true),
  version: z.string(),
  git: z.object({ version: z.string() }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Short hash of a repository's absolute path. The client never sends raw paths. */
export const RepoId = z.string().regex(/^[0-9a-f]{12}$/, 'expected a 12-character repository id');

export const RepoSummary = z.object({
  id: RepoId,
  name: z.string(),
  path: z.string(),
  bare: z.boolean(),
});
export type RepoSummary = z.infer<typeof RepoSummary>;

export const ReposResponse = z.object({
  repos: z.array(RepoSummary),
});
export type ReposResponse = z.infer<typeof ReposResponse>;

export const RepoInfo = RepoSummary.extend({
  shallow: z.boolean(),
  head: z.object({
    /** null: no commits yet (unborn HEAD). */
    sha: z.string().nullable(),
    /** null: detached HEAD. */
    branch: z.string().nullable(),
  }),
  /** Commits reachable from branches, remote branches, tags and HEAD. */
  commitCount: z.number().int().nonnegative(),
});
export type RepoInfo = z.infer<typeof RepoInfo>;
