import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { fixtures, startGittree, type Gittree } from './gittree.ts';

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
  await gittree.stop();
});

test('signs in with the one-time link and opens the history', async () => {
  await page.goto(gittree.authUrl);
  await expect(page).toHaveURL(new RegExp(`^${gittree.origin}/r/[0-9a-f]{12}/history$`));
  await expect(page.getByRole('heading', { name: 'merges', exact: true })).toBeVisible();
  await expect(page.locator(`[role=option][data-sha="${fixtures.repos.merges.shas.head}"]`)).toHaveAttribute('aria-selected', 'true');

  await page.reload(); // the session cookie keeps working
  await expect(page.getByRole('heading', { name: 'merges', exact: true })).toBeVisible();
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
