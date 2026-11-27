import { GitError } from './errors.ts';
import type { GitRunner } from './runner.ts';

/**
 * A partial clone (`git clone --filter=blob:none`, …) stores every commit but only some file
 * contents. git would download the rest whenever a command needs them; the runner forbids that
 * (GIT_NO_LAZY_FETCH in env.ts), so such a command fails instead, in one of two ways:
 *
 * - Diffs first fetch everything they need in one batch. Failing that, git says it couldn't fetch
 *   from the promisor remote, which happens only in a partial clone.
 * - Other reads (a combined `--cc` diff, …) just can't read the object. Outside a partial clone,
 *   that means the repository is damaged.
 */
const COULD_NOT_FETCH = /^fatal: could not fetch [0-9a-f]{40,64} from promisor remote\r?$/m;
const UNABLE_TO_READ = /^fatal: unable to read [0-9a-f]{40,64}\r?$/m;

/** Whether `error` is git failing over an object that the partial clone at `cwd` doesn't store locally. */
export async function isMissingObjectError(git: GitRunner, cwd: string, error: unknown, signal?: AbortSignal): Promise<boolean> {
  if (!(error instanceof GitError) || error.code !== 'GIT_FAILED') return false;
  if (COULD_NOT_FETCH.test(error.stderr)) return true;
  return UNABLE_TO_READ.test(error.stderr) && (await isPartialClone(git, cwd, signal));
}

const NOT_TRUE = /^(?:false|no|off|0)$/i;

/**
 * Whether the repository has a promisor remote, which is what makes it a partial clone:
 * `remote.<name>.promisor=true`, or `extensions.partialClone=<remote>` as older git wrote it.
 */
export async function isPartialClone(git: GitRunner, cwd: string, signal?: AbortSignal): Promise<boolean> {
  const output = await git.text('config', {
    cwd,
    signal,
    args: ['-z', '--get-regexp', String.raw`^(extensions\.partialclone|remote\..+\.promisor)$`],
    okExitCodes: [0, 1], // 1: no such key
  });
  for (const entry of output.split('\0')) {
    if (entry === '') continue;
    const newline = entry.indexOf('\n');
    // A key without "= value" is a boolean true.
    const [key, value] = newline === -1 ? [entry, 'true'] : [entry.slice(0, newline), entry.slice(newline + 1)];
    if (key === 'extensions.partialclone' || !NOT_TRUE.test(value)) return true;
  }
  return false;
}
