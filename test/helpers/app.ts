import type { LightMyRequestResponse } from 'fastify';
import { join } from 'node:path';

import { createApp, type App } from '../../src/server/app.ts';
import { GitRunner } from '../../src/server/git/runner.ts';
import { RepoRegistry } from '../../src/server/repos/registry.ts';
import { resolveRepo, type Repo } from '../../src/server/repos/repo.ts';
import type { ApiRateLimit } from '../../src/server/security/rate-limit.ts';
import { Session } from '../../src/server/security/session.ts';

/** inject() never listens, so tests pick the port the Host check expects. */
export const TEST_PORT = 47_123;
export const HOST = `127.0.0.1:${TEST_PORT}`;

export interface TestApp {
  app: App;
  session: Session;
  repos: Repo[];
  git: GitRunner;
}

export async function makeTestApp(
  repoDirs: readonly string[],
  options: { webRoot?: string | null; extraOrigins?: string[]; configDir?: string; rateLimit?: ApiRateLimit } = {},
): Promise<TestApp> {
  const git = new GitRunner();
  const registry = new RepoRegistry();
  const repos: Repo[] = [];
  for (const dir of repoDirs) repos.push(registry.add(await resolveRepo(git, dir)));
  const session = new Session();
  const app = await createApp({
    git,
    gitVersion: '2.99.0',
    registry,
    session,
    // Never the user's own settings: a folder that doesn't exist unless a test passes one.
    configDir: options.configDir ?? join(repoDirs[0] ?? '/nonexistent', '.no-gittree-config'),
    webRoot: options.webRoot ?? null,
    port: TEST_PORT,
    extraOrigins: options.extraOrigins,
    rateLimit: options.rateLimit,
  });
  return { app, session, repos, git };
}

/** Signs in through /auth and returns the Cookie header value. */
export async function signIn({ app, session }: TestApp): Promise<string> {
  const response = await app.inject({ url: `/auth?token=${session.token}`, headers: { host: HOST } });
  const cookie = response.cookies[0];
  if (response.statusCode !== 302 || !cookie) throw new Error(`sign-in failed with ${response.statusCode}`);
  return `${cookie.name}=${cookie.value}`;
}

export function json<T = unknown>(response: LightMyRequestResponse): T {
  return response.json<T>();
}
