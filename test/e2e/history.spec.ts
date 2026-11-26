import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { fixtures, startGittree, type Gittree } from './gittree.ts';

/** PLAN §11 E2E for M1: open a fixture, hover, click, keys, Back/Forward, branch focus, order. */
test.describe.configure({ mode: 'serial' });

const { shas } = fixtures.repos.merges;

let gittree: Gittree;
let context: BrowserContext;
let page: Page;
let historyUrl: string;

const row = (sha: string): Locator => page.locator(`[role=option][data-sha="${sha}"]`);
const rowNamed = (subject: string): Locator => page.locator('[role=option]').filter({ hasText: subject });
const panelTitle = () => page.getByRole('complementary', { name: 'Selected commit' }).getByRole('heading');
const selectedSha = () => new URL(page.url()).searchParams.get('sel');

test.beforeAll(async ({ browser }) => {
  gittree = await startGittree(fixtures.repos.merges.dir);
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(gittree.authUrl);
  await expect(page).toHaveURL(/\/r\/[0-9a-f]{12}\/history$/);
  historyUrl = page.url();
});

test.afterAll(async () => {
  await context.close();
  await gittree.stop();
});

test('opens with HEAD selected and draws the graph', async () => {
  await expect(row(shas.head!)).toHaveAttribute('aria-selected', 'true');
  await expect(panelTitle()).toHaveText('Release 1.1.0');
  await expect(page.getByText('24 commits')).toBeVisible();
  // Every visible row draws its own slice of the graph.
  await expect(row(shas.octopus!).locator('svg path')).not.toHaveCount(0);
  await expect(rowNamed('SHOP-20 Search results').locator('[data-badge="feature/SHOP-20-search"]')).toBeVisible();
});

test('hover lights up the branch line and dims the rest', async () => {
  await rowNamed('SHOP-15 Cart model').hover();
  await expect(rowNamed('SHOP-15 Cart page')).not.toHaveAttribute('data-dim');
  await expect(rowNamed('SHOP-15 Cart model')).not.toHaveAttribute('data-dim');
  await expect(rowNamed('Release 1.1.0')).toHaveAttribute('data-dim', 'true');

  await page.mouse.move(5, 5); // leave the list
  await expect(page.locator('[role=option][data-dim]')).toHaveCount(0);
});

test('Alt+hover lights up all ancestors', async () => {
  await page.keyboard.down('Alt');
  await rowNamed("Merge branch 'cross/b'").hover();
  await expect(rowNamed('Initial commit')).not.toHaveAttribute('data-dim');
  await expect(rowNamed('SHOP-12 Add login form')).not.toHaveAttribute('data-dim');
  await expect(rowNamed('Topic: lint')).toHaveAttribute('data-dim', 'true');
  await page.keyboard.up('Alt');
  await page.mouse.move(5, 5);
});

test('click and keys move the selection; Back and Forward retrace it', async () => {
  const searchBox = rowNamed('SHOP-20 Search box');
  await searchBox.click();
  await expect(searchBox).toHaveAttribute('aria-selected', 'true');
  expect(selectedSha()).toBe(await searchBox.getAttribute('data-sha'));

  await page.keyboard.press('j'); // steps replace the history entry
  await expect(panelTitle()).toHaveText("Merge branch 'feature/SHOP-15-cart'");
  await page.keyboard.press('['); // first parent
  await expect(panelTitle()).toHaveText('Merge topics docs, ci and lint');
  await page.keyboard.press(']'); // back along the same line, not into a topic branch
  await expect(panelTitle()).toHaveText("Merge branch 'feature/SHOP-15-cart'");
  await page.keyboard.press('k');
  await expect(panelTitle()).toHaveText('SHOP-20 Search box');

  await page.goBack();
  await expect(panelTitle()).toHaveText('Merge topics docs, ci and lint');
  await page.goBack();
  await expect(panelTitle()).toHaveText("Merge branch 'feature/SHOP-15-cart'");
  await page.goBack();
  await expect(panelTitle()).toHaveText('Release 1.1.0');
  await page.goForward();
  await expect(panelTitle()).toHaveText("Merge branch 'feature/SHOP-15-cart'");
});

test('the summary links to parents and children', async () => {
  await page.goto(`${historyUrl}?sel=${shas['merge-login']}`);
  const panel = page.getByRole('complementary', { name: 'Selected commit' });
  await expect(panelTitle()).toHaveText("Merge branch 'feature/SHOP-12-login'");
  await expect(panel.getByText('v1.0.0')).toBeVisible();
  const parentLinks = panel.locator('dd').first().getByRole('button');
  await expect(parentLinks).toHaveCount(2);
  await parentLinks.nth(1).click();
  await expect(panelTitle()).toHaveText('SHOP-12 Login API client');
});

test('a deep link with an abbreviated hash selects and scrolls to that commit', async () => {
  await page.goto(`${historyUrl}?sel=${shas.root!.slice(0, 7)}`);
  await expect(row(shas.root!)).toHaveAttribute('aria-selected', 'true');
  await expect(row(shas.root!)).toBeInViewport();
  await page.reload();
  await expect(panelTitle()).toHaveText('Initial commit');
});

test('clicking a branch badge focuses the branch; Esc clears it', async () => {
  await page.goto(historyUrl);
  await page.locator('[data-badge="feature/SHOP-12-login"]').click();
  await expect(page).toHaveURL(/focus=feature%2FSHOP-12-login/);
  const status = page.getByRole('status');
  await expect(status).toContainText('feature/SHOP-12-login');
  await expect(status).toContainText('2 own commits');
  const [forkedFrom, mergedIn] = [status.getByRole('button').nth(0), status.getByRole('button').nth(1)];
  await expect(forkedFrom).toHaveAttribute('title', 'Add app shell');
  await expect(mergedIn).toHaveText(shas['merge-login']!.slice(0, 7));

  // Own commits, the fork point and the merge stay lit.
  await expect(rowNamed('SHOP-12 Login API client')).not.toHaveAttribute('data-dim');
  await expect(rowNamed('SHOP-12 Add login form')).not.toHaveAttribute('data-dim');
  await expect(rowNamed('Add app shell')).not.toHaveAttribute('data-dim');
  await expect(row(shas['merge-login']!)).not.toHaveAttribute('data-dim');
  await expect(rowNamed('Fix typo in README')).toHaveAttribute('data-dim', 'true');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page).not.toHaveURL(/focus=/);
  // The pointer still rests on the badge's row, so hover now lights that row's line…
  await expect(rowNamed('SHOP-12 Add login form')).not.toHaveAttribute('data-dim');
  await expect(rowNamed('Fix typo in README')).toHaveAttribute('data-dim', 'true');
  // …and leaving the list clears all dimming.
  await page.mouse.move(5, 5);
  await expect(page.locator('[role=option][data-dim]')).toHaveCount(0);
});

test('the order toggle switches to topo order and keeps the selection', async () => {
  await rowNamed('SHOP-12 Login API client').click();
  const selection = selectedSha();
  await page.getByRole('button', { name: 'Topo' }).click();
  await expect(page).toHaveURL(/order=topo/);
  expect(selectedSha()).toBe(selection);
  await expect(page.getByRole('button', { name: 'Topo' })).toHaveAttribute('aria-pressed', 'true');

  // Topo order keeps the login branch together, right below its merge (the date-order graph
  // stays on screen until the topo one has loaded).
  const belowMerge = () =>
    page.locator('[role=option]').evaluateAll((rows) => {
      const subjects = rows
        .sort((a, b) => Number(a.getAttribute('data-row')) - Number(b.getAttribute('data-row')))
        .map((r) => r.querySelector('span.truncate:not([data-badge])')?.textContent);
      return subjects[subjects.indexOf("Merge branch 'feature/SHOP-12-login'") + 1];
    });
  await expect.poll(belowMerge).toBe('SHOP-12 Login API client');
  await expect(row(selection!)).toHaveAttribute('aria-selected', 'true');
});

test.describe('other repositories', () => {
  test('a detached HEAD gets its own badge and is selected', async ({ browser }) => {
    const detached = await startGittree(fixtures.repos.detached.dir);
    const other = await browser.newContext();
    try {
      const tab = await other.newPage();
      await tab.goto(detached.authUrl);
      const head = tab.locator(`[role=option][data-sha="${fixtures.repos.detached.shas['detached-at']}"]`);
      await expect(head).toHaveAttribute('aria-selected', 'true');
      await expect(head.locator('[data-badge="HEAD"]')).toBeVisible();
      await expect(tab.getByText('detached HEAD')).toBeVisible();
    } finally {
      await other.close();
      await detached.stop();
    }
  });

  test('a repository without commits says so', async ({ browser }) => {
    const empty = await startGittree(fixtures.repos.empty.dir);
    const other = await browser.newContext();
    try {
      const tab = await other.newPage();
      await tab.goto(empty.authUrl);
      await expect(tab.getByRole('heading', { name: 'No commits yet' })).toBeVisible();
      await expect(tab.getByText('HEAD is on main, which has no commits.')).toBeVisible();
    } finally {
      await other.close();
      await empty.stop();
    }
  });
});
