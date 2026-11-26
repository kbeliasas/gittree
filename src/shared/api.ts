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

/** Full commit hash: 40 hex characters (SHA-1 repositories) or 64 (SHA-256). */
export const Sha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, 'expected a full commit hash');

export const HeadInfo = z.object({
  /** null: no commits yet (unborn HEAD). */
  sha: Sha.nullable(),
  /** null: detached HEAD. */
  branch: z.string().nullable(),
});
export type HeadInfo = z.infer<typeof HeadInfo>;

export const RepoInfo = RepoSummary.extend({
  shallow: z.boolean(),
  head: HeadInfo,
  /** Commits reachable from branches, remote branches, tags and HEAD. */
  commitCount: z.number().int().nonnegative(),
});
export type RepoInfo = z.infer<typeof RepoInfo>;

// ---------------------------------------------------------------------------
// History graph

export const GraphOrder = z.enum(['date', 'topo']);
export type GraphOrder = z.infer<typeof GraphOrder>;

/** Commits per graph page. PLAN targets repositories below this size, so one page is the norm. */
export const GRAPH_PAGE_SIZE = 10_000;
export const GRAPH_MAX_PAGE_SIZE = 50_000;

export const GraphQuery = z.object({
  order: GraphOrder.default('date'),
  limit: z.coerce.number().int().min(1).max(GRAPH_MAX_PAGE_SIZE).default(GRAPH_PAGE_SIZE),
  /** `page.next` from the previous page. */
  cursor: z.string().max(100).optional(),
});
export type GraphQuery = z.infer<typeof GraphQuery>;

export const GraphCommit = z.object({
  sha: Sha,
  /**
   * First parent first. A number is an index into the graph's commits (counting
   * from the first page); a hash is a parent that is on a later page.
   */
  parents: z.array(z.union([z.number().int().nonnegative(), Sha])),
  /** Shallow clone: this commit's parents aren't in the repository. */
  boundary: z.literal(true).optional(),
  /** Index into this page's `authors`. */
  author: z.number().int().nonnegative(),
  /** Unix seconds. */
  authorTime: z.number().int(),
  commitTime: z.number().int(),
  subject: z.string(),
});
export type GraphCommit = z.infer<typeof GraphCommit>;

export const RefKind = z.enum(['local', 'remote', 'tag']);
export type RefKind = z.infer<typeof RefKind>;

export const GraphRef = z.object({
  /** Short name: "main", "origin/main", "v1.2.0". */
  name: z.string(),
  kind: RefKind,
  /** Index into the graph's commits. Annotated tags are peeled to their commit. */
  commit: z.number().int().nonnegative(),
  /** Branches only: the branch this one tracks, e.g. "origin/main". */
  upstream: z.string().optional(),
  /** The upstream branch is gone from the remote (noticed by a pruning fetch). */
  upstreamGone: z.literal(true).optional(),
});
export type GraphRef = z.infer<typeof GraphRef>;

export const GraphPayload = z.object({
  /** Hash of every ref and HEAD: changes whenever the history could look different. */
  snapshot: z.string(),
  order: GraphOrder,
  head: HeadInfo,
  /** A local or remote branch name (as in `refs`), or null when the repository has no branches. */
  defaultBranch: z.string().nullable(),
  authors: z.array(z.object({ name: z.string(), email: z.string() })),
  /** Newest first, in `order`; parents always come after their children. */
  commits: z.array(GraphCommit),
  /** Refs that point at commits on this page. */
  refs: z.array(GraphRef),
  page: z.object({
    /** Index of this page's first commit in the whole graph. */
    offset: z.number().int().nonnegative(),
    /** Commits in the whole graph. */
    total: z.number().int().nonnegative(),
    /** Cursor for the next page; null on the last page. */
    next: z.string().nullable(),
  }),
});
export type GraphPayload = z.infer<typeof GraphPayload>;
