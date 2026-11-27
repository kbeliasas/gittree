import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, inject, it } from 'vitest';

import { fixtureGitEnv } from '../../../test/fixtures/build.ts';
import { GitError } from './errors.ts';
import { isMissingObjectError, isPartialClone } from './partial.ts';
import { GitRunner } from './runner.ts';

const fixtures = inject('fixtures');
const { partial, partialBare, conflicts } = fixtures.repos;
const git = new GitRunner();

const OID = '48f2d3adbc19d963e149521ff8f11714f7745252';
const failed = (stderr: string) => new GitError('GIT_FAILED', 'git diff-tree: failed', { exitCode: 128, stderr });
const COULD_NOT_FETCH = `warning: lazy fetching disabled; some objects may not be available\nfatal: could not fetch ${OID} from promisor remote\n`;

describe('isMissingObjectError', () => {
  it("recognises a diff that couldn't fetch what it needs, wherever it ran", async () => {
    expect(await isMissingObjectError(git, partial.dir, failed(COULD_NOT_FETCH))).toBe(true);
    expect(await isMissingObjectError(git, partial.dir, failed(COULD_NOT_FETCH.replace(/\n/g, '\r\n')))).toBe(true);
    // Older git tried to download it and failed (offline, say).
    const offline = `fatal: unable to access 'https://example.com/r.git/': Could not resolve host\nfatal: could not fetch ${OID} from promisor remote\n`;
    expect(await isMissingObjectError(git, conflicts.dir, failed(offline))).toBe(true);
  });

  it('counts an unreadable object as missing only in a partial clone', async () => {
    const unreadable = failed(`fatal: unable to read ${OID}\n`);
    expect(await isMissingObjectError(git, partial.dir, unreadable)).toBe(true);
    expect(await isMissingObjectError(git, partialBare.dir, unreadable)).toBe(true);
    expect(await isMissingObjectError(git, conflicts.dir, unreadable)).toBe(false); // a damaged repository
  });

  it('ignores other failures, the warning on its own and errors that are not git failures', async () => {
    const no = (error: unknown) => isMissingObjectError(git, partial.dir, error);
    expect(await no(failed(`fatal: bad object ${OID}\n`))).toBe(false);
    expect(await no(failed('warning: lazy fetching disabled; some objects may not be available\n'))).toBe(false);
    expect(await no(new GitError('GIT_TIMEOUT', 'timed out', { stderr: COULD_NOT_FETCH }))).toBe(false);
    expect(await no(new Error(COULD_NOT_FETCH))).toBe(false);
  });
});

describe('isPartialClone', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  /** A new repository with `config` appended to its .git/config. */
  const repoWith = (config: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'gittree-partial-'));
    dirs.push(dir);
    execFileSync('git', ['init', '-q', dir], { env: fixtureGitEnv(fixtures.root) });
    appendFileSync(join(dir, '.git', 'config'), config);
    return dir;
  };

  it('finds the promisor remote of a blobless clone, bare or not', async () => {
    expect(await isPartialClone(git, partial.dir)).toBe(true);
    expect(await isPartialClone(git, partialBare.dir)).toBe(true);
    expect(await isPartialClone(git, conflicts.dir)).toBe(false);
  });

  it('reads both ways git records one, and boolean spellings', async () => {
    expect(await isPartialClone(git, repoWith('[extensions]\n\tpartialClone = origin\n'))).toBe(true);
    expect(await isPartialClone(git, repoWith('[remote "a"]\n\tpromisor = false\n[remote "b"]\n\tpromisor\n'))).toBe(true);
    expect(await isPartialClone(git, repoWith('[remote "Origin"]\n\tpromisor = Yes\n'))).toBe(true);
    expect(await isPartialClone(git, repoWith('[remote "a"]\n\tpromisor = off\n\turl = /nowhere\n'))).toBe(false);
  });
});
