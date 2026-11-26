import { tmpdir } from 'node:os';

import { GitError } from './errors.ts';
import type { GitRunner } from './runner.ts';

export type Version = readonly [major: number, minor: number, patch: number];

export const MIN_GIT_VERSION: Version = [2, 30, 0];

/** Parses `git version 2.50.1 (Apple Git-155)`, `git version 2.45.2.windows.1`, … */
export function parseGitVersion(output: string): Version | null {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function formatVersion(v: Version): string {
  return v.join('.');
}

/** Returns the installed git version, or throws with a message fit for the terminal. */
export async function checkGitVersion(git: GitRunner): Promise<string> {
  const output = await git.text('version', { cwd: tmpdir() });
  const version = parseGitVersion(output);
  if (!version) {
    throw new GitError('GIT_UNSUPPORTED', `could not read the git version from ${JSON.stringify(output.trim())}`);
  }
  if (compareVersions(version, MIN_GIT_VERSION) < 0) {
    throw new GitError(
      'GIT_UNSUPPORTED',
      `git ${formatVersion(version)} is too old; gittree needs ${formatVersion(MIN_GIT_VERSION)} or newer`,
    );
  }
  return formatVersion(version);
}
