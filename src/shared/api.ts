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

/** Where the repository's commits can be viewed on the web, derived from a remote's URL (no API calls). */
export const WebLink = z.object({
  /** "GitHub", "GitLab", "Bitbucket", "Azure DevOps". */
  host: z.string(),
  /** A commit's page; `{sha}` stands for the full hash. */
  commitUrl: z.string(),
});
export type WebLink = z.infer<typeof WebLink>;

export const RepoInfo = RepoSummary.extend({
  shallow: z.boolean(),
  head: HeadInfo,
  /** Commits reachable from branches, remote branches, tags and HEAD. */
  commitCount: z.number().int().nonnegative(),
  /** From `origin` (or the first remote), when it is a known hosting service. */
  web: WebLink.nullable(),
});
export type RepoInfo = z.infer<typeof RepoInfo>;

// ---------------------------------------------------------------------------
// Settings. M2 reads them from the config file; M4 adds the Settings view.

export const JiraSettings = z.object({
  /** e.g. https://acme.atlassian.net. Keys link to `<baseUrl>/browse/KEY-1`; null: keys aren't links. */
  baseUrl: z.string().nullable(),
  /** Known project keys ("SHOP"); empty: a generic KEY-123 pattern with a deny-list. */
  projectKeys: z.array(z.string()),
});
export type JiraSettings = z.infer<typeof JiraSettings>;

export const SettingsResponse = z.object({
  /** The config file, for hints such as "set jira.baseUrl in …". */
  path: z.string(),
  jira: JiraSettings,
  /** What couldn't be used (unreadable JSON, invalid values); everything else still applies. */
  problems: z.array(z.string()),
});
export type SettingsResponse = z.infer<typeof SettingsResponse>;

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

// ---------------------------------------------------------------------------
// Commit details and diffs

/** Octopus merges rarely have more than a handful of parents; git itself allows many. */
export const MAX_PARENTS = 64;

/**
 * What a commit is compared with: a parent (1 = first) or `cc`, a merge's
 * conflict resolutions (git's `--cc`: only hunks that differ from every parent).
 * In a query string it is `parent=2` or `parent=cc`.
 */
export const CompareWith = z.union([z.literal('cc'), z.coerce.number().int().min(1).max(MAX_PARENTS)]);
export type CompareWith = z.infer<typeof CompareWith>;

export const CommitQuery = z.object({ parent: CompareWith.default(1) });
export type CommitQuery = z.infer<typeof CommitQuery>;

export const Signature = z.object({
  name: z.string(),
  email: z.string(),
  /** Unix seconds. */
  time: z.number().int(),
  /** The signer's UTC offset in minutes, e.g. 120 for +0200. */
  tz: z.number().int(),
});
export type Signature = z.infer<typeof Signature>;

export const FileStatus = z.enum(['added', 'modified', 'deleted', 'renamed', 'copied', 'typechange', 'unmerged', 'unknown']);
export type FileStatus = z.infer<typeof FileStatus>;

export const ChangedFile = z.object({
  /** Path in the commit (for deletions: where the file was). */
  path: z.string(),
  /** Renames and copies: where the file came from. */
  oldPath: z.string().optional(),
  status: FileStatus,
  /** Renames and copies: similarity in percent. */
  similarity: z.number().int().min(0).max(100).optional(),
  /** Lines added and removed; null for binary files and in conflict-resolution lists. */
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  binary: z.literal(true).optional(),
  /** Octal modes ("100644", "100755", "120000" symlink, "160000" submodule); "000000" where the file is absent. */
  oldMode: z.string(),
  newMode: z.string(),
  /** Bytes; absent where the file is absent and for submodules. */
  oldSize: z.number().int().nonnegative().optional(),
  newSize: z.number().int().nonnegative().optional(),
});
export type ChangedFile = z.infer<typeof ChangedFile>;

export const CommitDetails = z.object({
  sha: Sha,
  /** Full hashes, first parent first. Empty for root commits and shallow-clone boundaries. */
  parents: z.array(Sha),
  /** Shallow clone: the parents aren't in the repository. */
  boundary: z.literal(true).optional(),
  author: Signature,
  committer: Signature,
  /** Subject, blank line, body — as written, after re-encoding to UTF-8. */
  message: z.string(),
  /** The changed files; null when they can't be computed (a shallow clone's boundary commit). */
  compare: z
    .object({
      /** A parent number, `cc` (conflict resolutions) or `root` (a root commit: everything is new). */
      with: z.union([z.number().int().min(1), z.literal('cc'), z.literal('root')]),
      files: z.array(ChangedFile),
    })
    .nullable(),
});
export type CommitDetails = z.infer<typeof CommitDetails>;

export const DiffQuery = z.object({
  sha: Sha,
  parent: CompareWith.default(1),
  /** A path from the commit's file list (`ChangedFile.path`). */
  path: z.string().min(1).max(4096),
  /** `1`: ignore whitespace (`git diff -w`). */
  ws: z.enum(['0', '1']).default('0'),
});
export type DiffQuery = z.infer<typeof DiffQuery>;

const LineRange = z.object({ start: z.number().int().nonnegative(), count: z.number().int().nonnegative() });

export const DiffHunk = z.object({
  /** The range in each parent: one for ordinary diffs, one per parent for combined diffs. */
  old: z.array(LineRange).min(1),
  new: LineRange,
  /** Text after the closing @@, usually the enclosing function. */
  heading: z.string(),
  /**
   * Lines with their markers: one column per parent ('+', '-' or ' '), then the text.
   * A line starting with '\' says the line before it has no final newline.
   */
  lines: z.array(z.string()),
});
export type DiffHunk = z.infer<typeof DiffHunk>;

export const FileDiff = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: FileStatus,
  binary: z.literal(true).optional(),
  /** The hunks hold the whole file; the viewer folds unchanged lines and can unfold them without asking again. */
  fullContext: z.boolean(),
  /** Marker columns per line: 1, or the number of parents in a combined (`cc`) diff. */
  columns: z.number().int().min(1),
  hunks: z.array(DiffHunk),
});
export type FileDiff = z.infer<typeof FileDiff>;

/** Diffs with more changed lines than this wait for a "Load diff" click (PLAN §8: large diffs collapsed). */
export const DIFF_AUTOLOAD_MAX_LINES = 2_000;
