// `pnpm dev [path] [--no-open]`: the API server (scripts/dev-server.ts under
// `node --watch`) plus Vite with hot reload, which proxies /api and /auth to it.
// Opens the browser on Vite's address with a sign-in link that keeps working
// across server restarts.
import { spawn, type ChildProcess } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { openBrowser } from '../src/server/open-browser.ts';
import { randomSecret } from '../src/server/security/session.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: { open: { type: 'boolean', default: true } },
});

const repo = resolve(positionals[0] ?? process.cwd());
const apiPort = await freePort(0);
const webPort = await freePort(5173);
const webOrigin = `http://127.0.0.1:${webPort}`;
const token = randomSecret();

const children: ChildProcess[] = [
  spawn(process.execPath, ['--watch', 'scripts/dev-server.ts'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      GITTREE_REPO: repo,
      GITTREE_API_PORT: String(apiPort),
      GITTREE_DEV_TOKEN: token,
      GITTREE_DEV_SECRET: randomSecret(),
      GITTREE_DEV_ORIGIN: webOrigin,
    },
  }),
  spawn(join('node_modules', '.bin', 'vite'), ['--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    stdio: 'inherit',
    env: { ...process.env, GITTREE_API_PORT: String(apiPort) },
  }),
];

let stopping = false;
const stopAll = (code: number) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
};
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
for (const child of children) child.on('exit', (code) => stopAll(code ?? 0));

await Promise.all([waitForPort(apiPort), waitForPort(webPort)]);
const url = `${webOrigin}/auth?token=${token}`;
process.stdout.write(`\n  gittree dev: ${url}\n\n`);
if (values.open) openBrowser(url);

/** The preferred port if it's free, otherwise any free port. */
function freePort(preferred: number): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (preferred !== 0 && error.code === 'EADDRINUSE') resolvePort(freePort(0));
      else reject(error);
    });
    server.listen(preferred, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : preferred;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((done) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        done(true);
      });
      socket.once('error', () => done(false));
    });
    if (open) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`nothing is listening on port ${port} after ${timeoutMs} ms`);
}
