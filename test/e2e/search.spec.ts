import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { fixtures, startGittree, type Gittree } from './gittree.ts';

/** PLAN §11 E2E for M3's search bar: suggestions, dim and hide, stepping, negation, tickets, bodies. */
test.describe.configure({ mode: 'serial' });

let gittree: Gittree;
let context: BrowserContext;
let page: Page;
let historyUrl: string;

const searchBox = () => page.getByRole('combobox', { name: 'Search commits' });
const suggestion = (name: RegExp) => page.getByRole('listbox', { name: 'Suggestions' }).getByRole('option', { name });
const rowNamed = (subject: string): Locator => page.locator('[role=option]').filter({ hasText: subject });
const litRows = () => page.locator('[role=option]:not([data-dim])');
const panelTitle = () => page.getByRole('complementary', { name: 'Selected commit' }).getByRole('heading', { level: 2 });
const query = () => new URL(page.url()).searchParams.get('q');
const subjects = (rows: Locator) =>
  rows.evaluateAll((list) =>
    list
      .sort((a, b) => Number(a.getAttribute('data-row')) - Number(b.getAttribute('data-row')))
      .map((r) => r.querySelector('span.truncate:not([data-badge])')?.textContent),
  );

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

test('/ opens the search; suggestions complete keys and authors; the rest dims', async () => {
  await page.locator('[data-commit-list]').focus();
  await page.keyboard.press('/');
  await expect(searchBox()).toBeFocused();

  await page.keyboard.type('au');
  await expect(suggestion(/^author:/)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(searchBox()).toHaveValue('author:');
  await page.keyboard.type('car');
  await expect(suggestion(/Carol Nguyen/)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(searchBox()).toHaveValue('author:"Carol Nguyen" ');

  await expect.poll(query).toBe('author:"Carol Nguyen"');
  await expect(page.getByText('6 matches')).toBeVisible();
  expect(await subjects(litRows())).toEqual([
    'SHOP-15 Cart page',
    'SHOP-15 Cart model',
    'Merge topics docs, ci and lint',
    'Topic: lint',
    'Topic: ci',
    'Topic: docs',
  ]);
  await expect(rowNamed('Release 1.1.0')).toHaveAttribute('data-dim', 'true');
});

test('Enter goes to the first match; n and N step through the matches', async () => {
  await page.keyboard.press('Enter');
  await expect(panelTitle()).toHaveText('SHOP-15 Cart page');
  await expect(page.locator('[data-commit-list]')).toBeFocused();

  await page.keyboard.press('n');
  await expect(panelTitle()).toHaveText('SHOP-15 Cart model');
  await page.keyboard.press('Shift+N');
  await page.keyboard.press('Shift+N');
  await expect(panelTitle()).toHaveText('Topic: docs'); // wraps around
});

test('Hide shows only the matches, linked through the commits in between', async () => {
  await page.getByRole('group', { name: 'Search misses' }).getByRole('button', { name: 'Hide' }).click();
  await expect(page).toHaveURL(/matches=hide/);
  await expect(page.locator('[role=option]')).toHaveCount(6);
  await expect(page.locator('[role=option][data-dim]')).toHaveCount(0);
  // The topics still join their octopus merge.
  await expect(rowNamed('Merge topics docs, ci and lint').locator('svg path')).not.toHaveCount(0);

  // Keys move between the commits shown.
  await page.locator('[data-commit-list]').focus();
  await page.keyboard.press('Home');
  await expect(panelTitle()).toHaveText('SHOP-15 Cart page');
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect(panelTitle()).toHaveText('Merge topics docs, ci and lint');

  await page.goBack(); // Back to Dim
  await expect(page).not.toHaveURL(/matches=hide/);
  await expect(page.locator('[role=option]')).toHaveCount(24);
});

test('a hidden selection stays in the details; the keys continue from where it would be', async () => {
  await page.goto(`${historyUrl}?q=${encodeURIComponent('jira:SHOP-12')}&matches=hide`);
  await expect(page.locator('[role=option]')).toHaveCount(3);
  await expect(panelTitle()).toHaveText('Release 1.1.0'); // HEAD, not shown
  await page.locator('[data-commit-list]').focus();
  await page.keyboard.press('j');
  await expect(panelTitle()).toHaveText("Merge branch 'feature/SHOP-12-login'");

  await page.goto(`${historyUrl}?q=nothing-like-this&matches=hide`);
  await expect(page.getByRole('heading', { name: 'No commits match' })).toBeVisible();
});

test('negated terms leave commits out; chips show the terms and remove them', async () => {
  await page.goto(`${historyUrl}?q=${encodeURIComponent('-author:alice merges:only')}`);
  await expect(page.getByText('3 matches')).toBeVisible();
  expect(await subjects(litRows())).toEqual(['Merge topics docs, ci and lint', "Merge branch 'cross/b'", 'Merge cross/a into cross/b']);

  const negated = page.locator('[data-chip="author"][data-negated]');
  await expect(negated).toContainText('not');
  await expect(negated).toContainText('alice');
  await negated.getByRole('button', { name: 'Remove -author:alice' }).click();
  await expect.poll(query).toBe('merges:only');
  await expect(page.getByText('7 matches')).toBeVisible();

  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect.poll(query).toBeNull();
  await expect(page.locator('[role=option][data-dim]')).toHaveCount(0);
});

test('clicking a chip edits the query there', async () => {
  await page.goto(`${historyUrl}?q=${encodeURIComponent('author:carol -merges:only cart')}`);
  await page.locator('[data-chip="merges"]').click();
  await expect(searchBox()).toBeFocused();
  await expect(searchBox()).toHaveValue('author:carol -merges:only cart');
  await expect(page.locator('[data-chip]')).toHaveCount(0);
  expect(await searchBox().evaluate((input) => ('selectionStart' in input ? input.selectionStart : null))).toBe('author:carol -merges:only'.length);

  await page.keyboard.press('Escape'); // back to the list, chips again
  await expect(page.locator('[data-commit-list]')).toBeFocused();
  await expect(page.locator('[data-chip]')).toHaveCount(3);
});

test('searches message bodies, hash prefixes and ref names', async () => {
  await page.goto(`${historyUrl}?q=${encodeURIComponent('api/session')}`);
  await expect(page.getByText('1 match')).toBeVisible();
  expect(await subjects(litRows())).toEqual(['SHOP-12 Login API client']);

  await page.goto(`${historyUrl}?q=${fixtures.repos.merges.shas.octopus!.slice(0, 6)}`);
  await expect.poll(() => subjects(litRows())).toEqual(['Merge topics docs, ci and lint']);

  await page.goto(`${historyUrl}?q=${encodeURIComponent('ref:v1.*')}`);
  await expect.poll(() => subjects(litRows())).toEqual(['Release 1.1.0', "Merge branch 'feature/SHOP-12-login'"]);
});

test('the ticket list toggles jira: terms, counting branch commits too', async () => {
  await page.goto(historyUrl);
  await page.getByRole('button', { name: /^Tickets/ }).click();
  const tickets = page.getByRole('group', { name: 'Jira tickets' });
  await expect(tickets.getByRole('button')).toHaveText(['✓SHOP-123', '✓SHOP-153', '✓SHOP-202']);
  await tickets.getByRole('button', { name: /SHOP-15/ }).click();
  await expect.poll(query).toBe('jira:SHOP-15');
  await expect(tickets.getByRole('button', { name: /SHOP-15/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => subjects(litRows())).toEqual(["Merge branch 'feature/SHOP-15-cart'", 'SHOP-15 Cart page', 'SHOP-15 Cart model']);

  await page.keyboard.press('Escape');
  await expect(tickets).toHaveCount(0);
  await expect.poll(query).toBe('jira:SHOP-15'); // Esc only closed the list
});

test('terms it cannot use are flagged and left out', async () => {
  await page.goto(`${historyUrl}?q=${encodeURIComponent('path:src after:someday')}`);
  await expect(page.locator('[data-chip="path"]')).toHaveAttribute('title', "path: search isn't available yet");
  await expect(page.locator('[data-chip="after"]')).toHaveAttribute('title', /Use a date like 2025-03-01/);
  await expect(page.locator('[role=option][data-dim]')).toHaveCount(0);
});
