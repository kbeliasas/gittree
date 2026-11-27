import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';

import { FIXTURE_CONFIG_HOME, type Fixtures } from '../fixtures/build.ts';

export const fixtures = JSON.parse(process.env.GITTREE_E2E_FIXTURES ?? 'null') as Fixtures;

export interface Gittree {
  process: ChildProcess;
  authUrl: string;
  origin: string;
  /** Everything gittree printed so far (with --verbose: one line per request). */
  output(): string;
  stop(): Promise<void>;
}

/**
 * Starts the built CLI the way a user would, and reads the sign-in link it prints. Its settings
 * come from the fixtures (Jira keys and base URL), never from the user's own config folder.
 */
export async function startGittree(repoDir: string): Promise<Gittree> {
  const child = spawn(process.execPath, ['dist/server/cli.js', repoDir, '--no-open', '--verbose'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, XDG_CONFIG_HOME: join(fixtures.root, FIXTURE_CONFIG_HOME) },
  });
  let output = '';
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const authUrl = await new Promise<string>((resolve, reject) => {
    const timer = setInterval(() => {
      const match = /http:\/\/127\.0\.0\.1:\d+\/auth\?token=[\w-]+/.exec(output);
      if (match) {
        clearInterval(timer);
        resolve(match[0]);
      }
    }, 50);
    setTimeout(() => {
      clearInterval(timer);
      reject(new Error(`gittree printed no sign-in link:\n${output}`));
    }, 15_000);
    child.once('exit', (code) => {
      clearInterval(timer);
      reject(new Error(`gittree exited with code ${code}:\n${output}`));
    });
  });
  return {
    process: child,
    authUrl,
    origin: new URL(authUrl).origin,
    output: () => output,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await once(child, 'exit');
    },
  };
}
