// API server for `pnpm dev`, restarted by `node --watch` on every server change.
// scripts/dev.ts passes the session token and secret in the environment, so a
// restart keeps the browser signed in. The production CLI never reads these.
import { resolveGitBinary } from '../src/server/git/binary.ts';
import { GitRunner } from '../src/server/git/runner.ts';
import { checkGitVersion } from '../src/server/git/version.ts';
import { RepoRegistry } from '../src/server/repos/registry.ts';
import { resolveRepo } from '../src/server/repos/repo.ts';
import { Session } from '../src/server/security/session.ts';
import { defaultConfigDir } from '../src/server/settings/settings.ts';
import { startServer } from '../src/server/start.ts';

const env = process.env;
const required = (name: string): string => {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set; start the dev setup with \`pnpm dev\``);
  return value;
};

const git = new GitRunner({ gitPath: await resolveGitBinary() });
const gitVersion = await checkGitVersion(git);
const registry = new RepoRegistry();
const repo = registry.add(await resolveRepo(git, required('GITTREE_REPO')));

const server = await startServer({
  git,
  gitVersion,
  registry,
  session: new Session({ token: required('GITTREE_DEV_TOKEN'), secret: required('GITTREE_DEV_SECRET') }),
  configDir: defaultConfigDir(),
  webRoot: null, // Vite serves the web app in dev
  listenPort: Number(required('GITTREE_API_PORT')),
  extraOrigins: [required('GITTREE_DEV_ORIGIN')],
  logRequests: true,
});

process.stdout.write(`[api] ${repo.name} (${repo.path}) on ${server.origin}\n`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void server.close().finally(() => process.exit(0)));
}
