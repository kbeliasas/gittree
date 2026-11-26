import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import type { Fixtures } from '../fixtures/build.ts';

const fixtures = JSON.parse(process.env.GITTREE_E2E_FIXTURES ?? 'null') as Fixtures;

interface Gittree {
  process: ChildProcess;
  authUrl: string;
  origin: string;
  /** Everything gittree printed so far (with --verbose: one line per request). */
  output(): string;
}

/** Starts the built CLI the way a user would, and reads the sign-in link it prints. */
async function startGittree(repoDir: string): Promise<Gittree> {
  const child = spawn(process.execPath, ['dist/server/cli.js', repoDir, '--no-open', '--verbose'], {
    stdio: ['ignore', 'pipe', 'pipe'],
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
  return { process: child, authUrl, origin: new URL(authUrl).origin, output: () => output };
}

test.describe.configure({ mode: 'serial' });

let gittree: Gittree;
let context: BrowserContext;
let page: Page;
let otherSite: Server;

test.beforeAll(async ({ browser }) => {
  gittree = await startGittree(fixtures.repos.merges.dir);
  context = await browser.newContext();
  page = await context.newPage();
  // Some other local web page, on another port of 127.0.0.1.
  otherSite = createServer((_req, res) => res.end('<!doctype html><title>other site</title>'));
  await new Promise<void>((resolve) => otherSite.listen(0, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await context.close();
  otherSite.close();
  gittree.process.kill('SIGTERM');
  await once(gittree.process, 'exit');
});

test('signs in with the one-time link and shows the repository', async () => {
  await page.goto(gittree.authUrl);
  await expect(page).toHaveURL(`${gittree.origin}/`);
  await expect(page.getByRole('heading', { name: 'merges' })).toBeVisible();
  await expect(page.getByText(fixtures.repos.merges.shas.head!.slice(0, 7))).toBeVisible();
  await expect(page.getByText('Connected. The history graph arrives in milestone M1.')).toBeVisible();

  await page.reload(); // the session cookie keeps working
  await expect(page.getByRole('heading', { name: 'merges' })).toBeVisible();
});

test('refuses the link a second time and in another browser profile', async ({ browser }) => {
  const stranger = await browser.newContext();
  const other = await stranger.newPage();

  const reused = await other.goto(gittree.authUrl);
  expect(reused?.status()).toBe(401);
  await expect(other.getByRole('heading', { name: 'This sign-in link was already used' })).toBeVisible();

  const home = await other.goto(gittree.origin);
  expect(home?.status()).toBe(401);
  await expect(other.getByRole('heading', { name: /isn’t signed in/ })).toBeVisible();
  await stranger.close();
});

test('does not answer API calls from other local pages, even when signed in', async () => {
  const other = await context.newPage();
  const { port } = otherSite.address() as AddressInfo;
  await other.goto(`http://127.0.0.1:${port}/`);

  const pageSaw = await other.evaluate(
    (url) =>
      fetch(url, { credentials: 'include' }).then(
        (response) => `read ${response.status}`,
        () => 'blocked',
      ),
    `${gittree.origin}/api/repos`,
  );
  expect(pageSaw).toBe('blocked'); // no CORS headers: the page can't read anything…
  // …and the server refused the request anyway (another port on 127.0.0.1 counts as same-site).
  await expect.poll(() => gittree.output()).toMatch(/^GET \/api\/repos 403 /m);
  await other.close();
});
