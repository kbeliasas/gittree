import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { GraphOrder, GraphPayload, GraphRef, HeadInfo } from '../../shared/api.ts';
import { GRAPH_LOG_FORMAT, parseGraphLog } from '../git/log.ts';
import { parseRefs, REF_PATTERNS, REFS_FORMAT, type ParsedRef } from '../git/refs.ts';
import type { GitRunner } from '../git/runner.ts';
import { readHead } from '../repos/head.ts';
import type { Repo } from '../repos/repo.ts';

/** Everything the history graph is drawn from, read at one moment. */
export interface RefsSnapshot {
  /** Hash of the refs, HEAD and the shallow boundary: equal ids mean an identical graph. */
  id: string;
  head: HeadInfo;
  refs: ParsedRef[];
  defaultBranch: string | null;
  /** Commits the history walk starts from: what every ref points at, plus HEAD. */
  tips: string[];
  /** Boundary commits of a shallow clone (git lists them without parents). */
  shallow: ReadonlySet<string>;
}

export async function readSnapshot(git: GitRunner, repo: Repo, signal?: AbortSignal): Promise<RefsSnapshot> {
  const cwd = repo.path;
  const [refsOutput, head, shallowProbe] = await Promise.all([
    git.text('for-each-ref', { cwd, signal, args: [REFS_FORMAT, ...REF_PATTERNS] }),
    readHead(git, repo, signal),
    // The shallow file lives in the common git dir; --git-path also finds it from a linked worktree.
    git.text('rev-parse', { cwd, signal, args: ['--is-shallow-repository', '--git-path', 'shallow'] }),
  ]);
  const [isShallow, shallowPath = 'shallow'] = shallowProbe.trimEnd().split('\n');
  const shallowList = isShallow === 'true' ? await readOptional(resolve(cwd, shallowPath)) : '';

  const { refs, originHead } = parseRefs(refsOutput);
  const tips = new Set(refs.map((ref) => ref.commit));
  if (head.sha) tips.add(head.sha);

  return {
    id: createHash('sha256')
      .update([refsOutput, head.branch ?? '', head.sha ?? '', shallowList].join('\0'))
      .digest('hex')
      .slice(0, 16),
    head,
    refs,
    defaultBranch: pickDefaultBranch(refs, originHead, head.branch),
    tips: [...tips],
    shallow: new Set(shallowList.split('\n').filter(Boolean)),
  };
}

/** PLAN §14: origin/HEAD → main → master → develop; then HEAD's branch, then any branch. Local names win over remote ones. */
export function pickDefaultBranch(refs: readonly ParsedRef[], originHead: string | null, headBranch: string | null): string | null {
  const locals = new Set(refs.filter((r) => r.kind === 'local').map((r) => r.name));
  const remotes = new Set(refs.filter((r) => r.kind === 'remote').map((r) => r.name));

  if (originHead?.startsWith('origin/')) {
    const name = originHead.slice('origin/'.length);
    if (locals.has(name)) return name;
    if (remotes.has(originHead)) return originHead;
  }
  const conventional = ['main', 'master', 'develop'];
  for (const name of conventional) if (locals.has(name)) return name;
  for (const name of conventional) if (remotes.has(`origin/${name}`)) return `origin/${name}`;
  if (headBranch && locals.has(headBranch)) return headBranch;
  return [...locals].sort()[0] ?? [...remotes].sort()[0] ?? null;
}

export interface GraphPageRequest {
  order: GraphOrder;
  /** Index of the first commit to return. */
  offset: number;
  limit: number;
  signal?: AbortSignal;
}

/**
 * One page of the commit graph. The walk starts from the snapshot's own commit
 * ids (passed on stdin), so the page matches the snapshot even if a ref moves
 * meanwhile, and a cursor can't skip or repeat commits.
 */
export async function readGraph(git: GitRunner, repo: Repo, snapshot: RefsSnapshot, request: GraphPageRequest): Promise<GraphPayload> {
  const { order, offset, limit, signal } = request;
  const base = { snapshot: snapshot.id, order, head: snapshot.head, defaultBranch: snapshot.defaultBranch };
  if (snapshot.tips.length === 0) {
    return { ...base, authors: [], commits: [], refs: [], page: { offset, total: 0, next: null } };
  }

  const cwd = repo.path;
  const input = `${snapshot.tips.join('\n')}\n`;
  const log = await git.run('log', {
    cwd,
    signal,
    input,
    args: [
      `--${order}-order`,
      GRAPH_LOG_FORMAT,
      `--max-count=${limit + 1}`, // one extra tells whether another page follows
      ...(offset > 0 ? [`--skip=${offset}`] : []),
      '--stdin',
    ],
  });
  const records = parseGraphLog(log.stdout.toString('utf8'));
  const hasMore = records.length > limit;
  if (hasMore) records.length = limit;
  const total =
    hasMore || offset > 0
      ? Number.parseInt(await git.text('rev-list', { cwd, signal, input, args: ['--count', '--stdin'] }), 10)
      : records.length;

  const index = new Map(records.map((record, i) => [record.sha, offset + i]));
  const authors: GraphPayload['authors'] = [];
  const authorIds = new Map<string, number>();
  const authorId = (name: string, email: string) => {
    const key = `${name}\0${email}`;
    let id = authorIds.get(key);
    if (id === undefined) {
      id = authors.push({ name, email }) - 1;
      authorIds.set(key, id);
    }
    return id;
  };

  const commits: GraphPayload['commits'] = records.map((record) => ({
    sha: record.sha,
    // Parents always come after their children, so a parent is on this page or a later one.
    parents: record.parents.map((parent) => index.get(parent) ?? parent),
    ...(snapshot.shallow.has(record.sha) ? { boundary: true as const } : {}),
    author: authorId(record.authorName, record.authorEmail),
    authorTime: record.authorTime,
    commitTime: record.commitTime,
    subject: record.subject,
  }));

  const refs: GraphRef[] = [];
  for (const ref of snapshot.refs) {
    const commit = index.get(ref.commit);
    if (commit === undefined) continue;
    refs.push({
      name: ref.name,
      kind: ref.kind,
      commit,
      ...(ref.upstream !== undefined ? { upstream: ref.upstream } : {}),
      ...(ref.upstreamGone ? { upstreamGone: true as const } : {}),
    });
  }

  return {
    ...base,
    authors,
    commits,
    refs,
    page: {
      offset,
      total,
      next: hasMore ? encodeCursor({ snapshot: snapshot.id, order, offset: offset + limit }) : null,
    },
  };
}

export interface GraphCursor {
  snapshot: string;
  order: GraphOrder;
  offset: number;
}

export function encodeCursor(cursor: GraphCursor): string {
  return `${cursor.snapshot}.${cursor.order}.${cursor.offset}`;
}

export function decodeCursor(text: string): GraphCursor | null {
  const match = /^([0-9a-f]{16})\.(date|topo)\.(\d{1,9})$/.exec(text);
  if (!match) return null;
  return { snapshot: match[1] as string, order: match[2] as GraphOrder, offset: Number(match[3]) };
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}
