export type GitErrorCode =
  | 'GIT_NOT_FOUND' // the git executable (or the working directory) does not exist
  | 'GIT_UNSUPPORTED' // installed git is older than gittree needs
  | 'GIT_DISALLOWED' // refused by the allowlist before anything was spawned
  | 'GIT_FAILED' // git exited with a code the caller did not expect
  | 'GIT_TIMEOUT'
  | 'GIT_ABORTED'
  | 'GIT_OUTPUT_TOO_LARGE';

export interface GitErrorDetails {
  args?: readonly string[];
  exitCode?: number | null;
  stderr?: string;
  cause?: unknown;
}

export class GitError extends Error {
  override readonly name = 'GitError';
  readonly code: GitErrorCode;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(code: GitErrorCode, message: string, details: GitErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.code = code;
    this.args = details.args ?? [];
    this.exitCode = details.exitCode ?? null;
    this.stderr = details.stderr ?? '';
  }
}
