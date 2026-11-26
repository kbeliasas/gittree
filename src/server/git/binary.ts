import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Finds the git executable that `git` on PATH runs. On macOS /usr/bin/git is
 * an xcrun shim that adds ~10 ms to every call; git's exec-path contains the
 * real binary. Falls back to `command` if anything looks unusual.
 */
export async function resolveGitBinary(command = 'git'): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, ['--exec-path'], { timeout: 10_000, windowsHide: true });
    const candidate = join(stdout.trim(), process.platform === 'win32' ? 'git.exe' : 'git');
    await access(candidate, constants.X_OK);
    return candidate;
  } catch {
    return command;
  }
}
