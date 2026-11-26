import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveGitBinary } from './binary.ts';
import { GitError } from './errors.ts';
import { GitRunner } from './runner.ts';
import { checkGitVersion, compareVersions, MIN_GIT_VERSION, parseGitVersion } from './version.ts';

describe('parseGitVersion', () => {
  it.each([
    ['git version 2.50.1 (Apple Git-155)', [2, 50, 1]],
    ['git version 2.45.2.windows.1', [2, 45, 2]],
    ['git version 2.30.0', [2, 30, 0]],
    ['git version 3.0', [3, 0, 0]],
  ] as const)('reads %j', (output, expected) => {
    expect(parseGitVersion(output)).toEqual(expected);
  });

  it('returns null for unrelated output', () => {
    expect(parseGitVersion('hello')).toBeNull();
  });

  it('orders versions', () => {
    expect(compareVersions([2, 29, 9], MIN_GIT_VERSION)).toBeLessThan(0);
    expect(compareVersions([2, 30, 0], MIN_GIT_VERSION)).toBe(0);
    expect(compareVersions([3, 0, 0], MIN_GIT_VERSION)).toBeGreaterThan(0);
  });
});

describe('checkGitVersion', () => {
  it('accepts the installed git', async () => {
    expect(await checkGitVersion(new GitRunner())).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('rejects git older than 2.30 with a clear message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gittree-old-git-'));
    try {
      const old = join(dir, 'git');
      writeFileSync(old, '#!/bin/sh\necho "git version 2.29.2"\n');
      chmodSync(old, 0o755);
      const error = await checkGitVersion(new GitRunner({ gitPath: old })).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitError);
      expect((error as GitError).code).toBe('GIT_UNSUPPORTED');
      expect((error as GitError).message).toBe('git 2.29.2 is too old; gittree needs 2.30.0 or newer');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveGitBinary', () => {
  it('finds a git binary that reports the same version as git on PATH', async () => {
    const binary = await resolveGitBinary();
    const viaPath = await checkGitVersion(new GitRunner());
    expect(await checkGitVersion(new GitRunner({ gitPath: binary }))).toBe(viaPath);
  });

  it('falls back to the given command when it cannot ask git', async () => {
    expect(await resolveGitBinary('/no/such/git')).toBe('/no/such/git');
  });
});
