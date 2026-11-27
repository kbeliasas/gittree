#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { resolveGitBinary } from './git/binary.ts';
import { GitError } from './git/errors.ts';
import { GitRunner } from './git/runner.ts';
import { checkGitVersion } from './git/version.ts';
import { openBrowser } from './open-browser.ts';
import { RepoRegistry } from './repos/registry.ts';
import { RepoError, resolveRepo } from './repos/repo.ts';
import { Session } from './security/session.ts';
import { defaultConfigDir } from './settings/settings.ts';
import { startServer } from './start.ts';
import { VERSION } from './version.ts';

const HELP = `Usage: gittree [path] [options]

Explore the history of the git repository at [path] (default: the current
folder) in your browser. gittree only reads your repository.

Options:
  -p, --port <n>   Port to listen on (default: a random free port)
      --no-open    Don't open the browser; just print the sign-in link
      --verbose    Log every request
  -v, --version    Print the version
  -h, --help       Show this help
`;

async function main(argv: string[]): Promise<number | undefined> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      allowNegative: true,
      options: {
        port: { type: 'string', short: 'p' },
        open: { type: 'boolean', default: true },
        verbose: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error) {
    fail(`${errorMessage(error)}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (positionals.length > 1) {
    fail(`expected at most one path, got ${positionals.length}\n\n${HELP}`);
    return 2;
  }
  const listenPort = parsePort(values.port);
  if (listenPort === null) {
    fail(`--port must be a whole number from 0 to 65535, got ${JSON.stringify(values.port)}`);
    return 2;
  }

  const git = new GitRunner({ gitPath: await resolveGitBinary() });
  const gitVersion = await checkGitVersion(git);
  const repo = await resolveRepo(git, positionals[0] ?? process.cwd());
  const registry = new RepoRegistry();
  registry.add(repo);

  const webRoot = findWebRoot();
  if (!webRoot) fail('the web app is not built yet (run `pnpm build`); the API works without it');

  let server;
  try {
    server = await startServer({
      git,
      gitVersion,
      registry,
      session: new Session(),
      configDir: defaultConfigDir(),
      webRoot,
      listenPort,
      logRequests: values.verbose,
    });
  } catch (error) {
    if (isErrno(error) && error.code === 'EADDRINUSE') {
      fail(`port ${listenPort} is already in use; pick another one with --port`);
      return 1;
    }
    throw error;
  }

  process.stdout.write(
    `gittree ${VERSION} · ${repo.name} (${repo.path})\n` +
      `Listening on ${server.origin}. Open this one-time sign-in link:\n\n` +
      `  ${server.authUrl}\n\n` +
      `Press Ctrl+C to stop.\n`,
  );
  if (values.open) {
    openBrowser(server.authUrl, () => fail('could not open a browser; open the link above yourself'));
  }

  const stop = () => {
    process.stdout.write('\nStopping gittree…\n');
    server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return undefined;
}

/** dist/web next to the built CLI, or the build output when running from source. */
function findWebRoot(): string | null {
  const here = fileURLToPath(import.meta.url);
  const dir = here.endsWith('.ts') ? join(here, '../../../dist/web') : join(here, '../../web');
  return existsSync(join(dir, 'index.html')) ? dir : null;
}

function parsePort(value: string | undefined): number | null {
  if (value === undefined) return 0;
  if (!/^\d{1,5}$/.test(value)) return null;
  const port = Number(value);
  return port <= 65_535 ? port : null;
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(message: string): void {
  process.stderr.write(`gittree: ${message}\n`);
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== undefined) process.exitCode = code;
  },
  (error: unknown) => {
    const expected = error instanceof RepoError || error instanceof GitError;
    fail(expected ? errorMessage(error) : (error instanceof Error && error.stack) || String(error));
    process.exitCode = 1;
  },
);
