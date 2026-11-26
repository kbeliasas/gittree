import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { GitError } from '../git/errors.ts';
import type { GitRunner } from '../git/runner.ts';

export interface Repo {
  /** Short hash of `path`; what the API and URLs use instead of raw paths. */
  id: string;
  /** Folder name, without `.git` for bare repositories. */
  name: string;
  /** Real path of the work tree root, or of the repository itself when bare. */
  path: string;
  /** Real path of the git directory (`.git`, or `.git/worktrees/<name>` for linked worktrees). */
  gitDir: string;
  bare: boolean;
}

export type RepoErrorCode = 'PATH_NOT_FOUND' | 'NOT_A_DIRECTORY' | 'NOT_A_REPO';

export class RepoError extends Error {
  override readonly name = 'RepoError';
  readonly code: RepoErrorCode;

  constructor(code: RepoErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function repoIdFor(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 12);
}

/**
 * Resolves any path inside a repository (work tree, subfolder, linked worktree,
 * the `.git` folder itself, or a bare repository) to the repository it belongs to.
 */
export async function resolveRepo(git: GitRunner, input: string): Promise<Repo> {
  const dir = await realDirectory(input);

  let probe: string;
  try {
    probe = await git.text('rev-parse', {
      cwd: dir,
      args: ['--is-bare-repository', '--is-inside-git-dir', '--absolute-git-dir'],
    });
  } catch (error) {
    if (error instanceof GitError && error.code === 'GIT_FAILED') {
      throw new RepoError('NOT_A_REPO', `not a git repository: ${dir}`);
    }
    throw error;
  }

  const [bareFlag, insideGitDirFlag, gitDirLine = ''] = probe.trimEnd().split('\n');
  const gitDir = await realpath(gitDirLine);

  if (bareFlag === 'true') return makeRepo(gitDir, gitDir, true);

  if (insideGitDirFlag === 'true') {
    // Pointed at the `.git` folder of a normal repository: use its work tree.
    if (basename(gitDir) === '.git') return resolveRepo(git, dirname(gitDir));
    throw new RepoError('NOT_A_REPO', `${dir} is inside a git directory; point gittree at the work tree instead`);
  }

  const topLevel = await git.text('rev-parse', { cwd: dir, args: ['--show-toplevel'] });
  return makeRepo(await realpath(topLevel.trimEnd()), gitDir, false);
}

async function realDirectory(input: string): Promise<string> {
  let dir: string;
  try {
    dir = await realpath(resolve(input));
  } catch {
    throw new RepoError('PATH_NOT_FOUND', `path not found: ${input}`);
  }
  if (!(await stat(dir)).isDirectory()) throw new RepoError('NOT_A_DIRECTORY', `not a directory: ${dir}`);
  return dir;
}

function makeRepo(path: string, gitDir: string, bare: boolean): Repo {
  const folder = basename(path);
  const name = bare && folder.endsWith('.git') && folder.length > 4 ? folder.slice(0, -4) : folder;
  return { id: repoIdFor(path), name, path, gitDir, bare };
}
