import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { BASE_CONFIG, gitEnv } from './env.ts';
import { GitError } from './errors.ts';
import { assertAllowed, type ArgParts, type ReadSubcommand, type Subcommand } from './policy.ts';

export interface GitRequest {
  /** Directory to run in: a work tree (or any folder inside it) or a bare repository. */
  cwd: string;
  /** Options written by gittree's own code, e.g. `--format=%H`. Never put user input here. */
  args?: readonly string[];
  /** User-influenced revisions, placed after `--end-of-options` so they can't act as options. */
  revs?: readonly string[];
  /** User-influenced paths, placed after `--`. Pass `[]` for a bare `--`. */
  paths?: readonly string[];
  /** Written to stdin (e.g. for `cat-file --batch`). Without it, stdin is closed. */
  input?: string | Buffer;
  signal?: AbortSignal;
  /** Default: 30 s. */
  timeoutMs?: number;
  /** Default: 64 MiB of stdout. */
  maxOutputBytes?: number;
  /** Exit codes that count as success. Default: [0]. */
  okExitCodes?: readonly number[];
  /**
   * false lets `paths` use pathspec magic such as `:(glob)`. Paths are literal by default
   * (GIT_LITERAL_PATHSPECS); only a search for a glob the user typed turns that off.
   */
  literalPathspecs?: boolean;
}

export interface GitResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

export interface GitRunnerOptions {
  /** Default: `git` from PATH. */
  gitPath?: string;
  /** Maximum git processes running at once. Default: 8. */
  maxConcurrent?: number;
  /** Environment to derive git's environment from. Default: process.env. */
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT = 64 * 1024 * 1024;
const MAX_STDERR_CHARS = 64 * 1024;
const KILL_GRACE_MS = 2_000;

/**
 * The only way gittree talks to git. Commands are checked against the
 * allowlist in policy.ts, arguments are passed as an array (no shell), and
 * user input is fenced off behind `--end-of-options` and `--`.
 */
export class GitRunner {
  readonly #gitPath: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #slots: Semaphore;

  constructor(options: GitRunnerOptions = {}) {
    this.#gitPath = options.gitPath ?? 'git';
    this.#env = gitEnv(options.env ?? process.env);
    this.#slots = new Semaphore(options.maxConcurrent ?? 8);
  }

  /** Runs an allowlisted read-only command. Rejects with a GitError. */
  run(sub: ReadSubcommand, req: GitRequest): Promise<GitResult> {
    return this.#exec(sub, req, { allowWrite: false });
  }

  /** Like run(), returning stdout decoded as UTF-8. */
  async text(sub: ReadSubcommand, req: GitRequest): Promise<string> {
    return (await this.run(sub, req)).stdout.toString('utf8');
  }

  async #exec(sub: Subcommand, req: GitRequest, opts: { allowWrite: boolean }): Promise<GitResult> {
    const argv = buildArgs(sub, req, opts);
    const release = await this.#slots.acquire(req.signal);
    try {
      return await spawnGit(this.#gitPath, argv, this.#env, req);
    } finally {
      release();
    }
  }
}

/** Validates a request and builds git's full argument list. Exported for tests. */
export function buildArgs(
  sub: Subcommand,
  req: Pick<GitRequest, 'args' | 'revs' | 'paths'>,
  opts: { allowWrite: boolean } = { allowWrite: false },
): string[] {
  const parts: ArgParts = { args: req.args ?? [], revs: req.revs ?? [], paths: req.paths ?? [] };
  assertAllowed(sub, parts, opts);
  const argv = [...BASE_CONFIG.flatMap((c) => ['-c', c]), sub, ...parts.args];
  // Only when there are revisions: some commands (rev-parse) echo a trailing --end-of-options.
  if (parts.revs.length > 0) argv.push('--end-of-options', ...parts.revs);
  if (req.paths !== undefined) argv.push('--', ...parts.paths);
  return argv;
}

function spawnGit(gitPath: string, argv: string[], env: NodeJS.ProcessEnv, req: GitRequest): Promise<GitResult> {
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutput = req.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const okExitCodes = req.okExitCodes ?? [0];
  const describe = `git ${argv.filter((a, i) => !(a === '-c' || argv[i - 1] === '-c')).join(' ')}`;

  return new Promise<GitResult>((resolve, reject) => {
    if (req.signal?.aborted) {
      reject(new GitError('GIT_ABORTED', `${describe}: aborted`, { args: argv }));
      return;
    }

    const child = spawn(gitPath, argv, {
      cwd: req.cwd,
      env: req.literalPathspecs === false ? { ...env, GIT_LITERAL_PATHSPECS: '0' } : env,
      stdio: [req.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // Its own process group, so stopping git also stops helpers it started (ssh, textconv
      // filters, …) that would otherwise keep the output pipes open.
      detached: process.platform !== 'win32',
    });

    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let failure: GitError | undefined;
    let settled = false;

    const killGroup = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        // already gone
      }
    };
    const stop = (error: GitError) => {
      if (failure) return;
      failure = error;
      killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS).unref();
    };
    const timer = setTimeout(
      () => stop(new GitError('GIT_TIMEOUT', `${describe}: timed out after ${timeoutMs} ms`, { args: argv })),
      timeoutMs,
    );
    const onAbort = () => stop(new GitError('GIT_ABORTED', `${describe}: aborted`, { args: argv }));
    req.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
      outcome();
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (failure) return;
      size += chunk.length;
      if (size > maxOutput) {
        stop(new GitError('GIT_OUTPUT_TOO_LARGE', `${describe}: output exceeded ${maxOutput} bytes`, { args: argv }));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_CHARS) stderr += chunk.toString('utf8');
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(() => {
        if (error.code === 'ENOENT') {
          const message = existsSync(req.cwd)
            ? `git executable not found (${gitPath}). Install git 2.30 or newer.`
            : `directory does not exist: ${req.cwd}`;
          reject(new GitError('GIT_NOT_FOUND', message, { args: argv, cause: error }));
        } else {
          reject(new GitError('GIT_FAILED', `${describe}: ${error.message}`, { args: argv, cause: error }));
        }
      });
    });

    // After a timeout or abort there's no output left to wait for.
    child.on('exit', () => {
      if (!failure) return;
      child.stdout?.destroy();
      child.stderr?.destroy();
      const error = failure;
      finish(() => reject(error));
    });

    child.on('close', (code) => {
      finish(() => {
        if (failure) {
          reject(failure);
          return;
        }
        const exitCode = code ?? -1;
        if (!okExitCodes.includes(exitCode)) {
          const reason = firstLine(stderr) || `exited with code ${exitCode}`;
          reject(new GitError('GIT_FAILED', `${describe}: ${reason}`, { args: argv, exitCode, stderr }));
          return;
        }
        resolve({ stdout: Buffer.concat(chunks, size), stderr, exitCode });
      });
    });

    if (req.input !== undefined) {
      child.stdin?.on('error', () => {}); // git may exit before reading everything; the exit code tells the story
      child.stdin?.end(req.input);
    }
  });
}

function firstLine(text: string): string {
  return text.trim().split('\n', 1)[0] ?? '';
}

/** Counting semaphore; a waiting acquire() can be cancelled with an AbortSignal. */
class Semaphore {
  #available: number;
  readonly #waiters: Array<() => void> = [];

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 1) throw new RangeError('maxConcurrent must be a positive integer');
    this.#available = size;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.#available > 0) {
      this.#available--;
      return this.#releaser();
    }
    await new Promise<void>((resolve, reject) => {
      const wake = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        const index = this.#waiters.indexOf(wake);
        if (index !== -1) this.#waiters.splice(index, 1);
        reject(new GitError('GIT_ABORTED', 'git command aborted while waiting to run'));
      };
      this.#waiters.push(wake);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    return this.#releaser();
  }

  #releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiters.shift();
      if (next) next(); // hand the slot straight to the next waiter
      else this.#available++;
    };
  }
}
