import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { NO_LAZY_FETCH_SUPPORTED } from '../helpers/git.ts';
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
  await page.goto(`${historyUrl}?q=${encodeURIComponent('regex:/x/g after:someday')}`);
  await expect(page.locator('[data-chip="regex"]')).toHaveAttribute('title', /Only the i flag works/);
  await expect(page.locator('[data-chip="after"]')).toHaveAttribute('title', /Use a date like 2025-03-01/);
  await expect(page.locator('[role=option][data-dim]')).toHaveCount(0);
});

test.describe('server search', () => {
  // Real code to search: retry and limit settings, a merge that resolved a conflict.
  const { shas } = fixtures.repos.conflicts;
  let server: Gittree;
  let tab: Page;
  let url: string;

  test.beforeAll(async () => {
    server = await startGittree(fixtures.repos.conflicts.dir);
    tab = await context.newPage();
    await tab.goto(server.authUrl);
    await expect(tab).toHaveURL(/\/history$/);
    url = tab.url();
  });
  test.afterAll(async () => {
    await tab.close();
    await server.stop();
  });

  const lit = () =>
    tab.locator('[role=option]:not([data-dim])').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-sha')));
  const box = () => tab.getByRole('combobox', { name: 'Search commits' });
  const option = (name: RegExp) => tab.getByRole('listbox', { name: 'Suggestions' }).getByRole('option', { name });

  test('path: completes folders and files from HEAD, and finds the commits that changed them', async () => {
    await box().focus();
    await tab.keyboard.type('path:s');
    await expect(option(/^src\/ folder/)).toBeVisible();
    await tab.keyboard.press('Tab');
    await expect(box()).toHaveValue('path:src/');
    await expect(option(/^src\/retry\.ts file/)).toBeVisible();
    await tab.keyboard.type('r');
    await tab.keyboard.press('Tab');
    await expect(box()).toHaveValue('path:src/retry.ts ');
    await expect(tab.getByText('4 matches')).toBeVisible();
    // The conflict resolution counts; the whitespace-only commit on limits.ts doesn't.
    expect(await lit()).toEqual([shas['conflict-merge'], shas['main-side'], shas['feature-tip'], shas.root]);
  });

  test('content: and regex: search changed text; Enter waits for the server, then goes to the first match', async () => {
    await tab.goto(url);
    await box().focus();
    await tab.keyboard.type('content:attempts');
    await tab.keyboard.press('Enter');
    await expect(tab.locator('[data-commit-list]')).toBeFocused();
    await expect(tab.locator(`[role=option][data-sha="${shas.root}"]`)).toHaveAttribute('aria-selected', 'true');
    expect(await lit()).toEqual([shas.root]);

    await tab.goto(`${url}?q=${encodeURIComponent('regex:/ATTEMPTS: [0-9]/i')}`);
    await expect(tab.getByText('3 matches')).toBeVisible();
    await tab.goto(`${url}?q=${encodeURIComponent('-path:src/limits.ts')}`);
    await expect(tab.getByText('No matches')).toBeVisible(); // every commit changed limits.ts
  });

  test('a regex git rejects shows git’s reason on the chip', async () => {
    await tab.goto(`${url}?q=${encodeURIComponent('regex:/(/ retry')}`);
    await expect(tab.locator('[data-chip="regex"]')).toHaveAttribute('title', /Invalid regular expression.*POSIX extended/);
    await expect(tab.getByText('3 matches')).toBeVisible(); // "retry" alone still applies
  });

  test('Stop keeps what was found; Search again starts over', async () => {
    // Hold the search request, so it is still running when Stop is pressed.
    const isSearch = (address: URL) => address.pathname.endsWith('/search');
    await tab.route(isSearch, () => {});
    await tab.goto(`${url}?q=${encodeURIComponent('content:"delayMs: 500"')}`);
    const progress = tab.locator('[data-search-progress]');
    await expect(progress).toContainText('Searching contents');
    await progress.getByRole('button', { name: 'Stop' }).click();
    await expect(tab.getByText('stopped, partial')).toBeVisible();
    await expect(progress).toHaveCount(0);

    await tab.unroute(isSearch);
    await tab.getByRole('button', { name: 'Search again' }).click();
    await expect(tab.getByText('1 match')).toBeVisible(); // main's "Retry once, back off longer"
    await expect(tab.getByText('stopped, partial')).toHaveCount(0);
  });

  test('in a partial clone, path: works and content: explains why it cannot', async ({ browser }) => {
    test.skip(!NO_LAZY_FETCH_SUPPORTED, 'git < 2.44 would download the missing contents');
    const partial = await startGittree(fixtures.repos.partial.dir);
    const other = await browser.newContext();
    try {
      const page2 = await other.newPage();
      await page2.goto(partial.authUrl);
      await expect(page2).toHaveURL(/\/history$/);
      const base = page2.url();
      await page2.goto(`${base}?q=${encodeURIComponent('path:NOTES.md')}`);
      await expect(page2.getByText('2 matches')).toBeVisible();
      await page2.goto(`${base}?q=${encodeURIComponent('content:attempts')}`);
      await expect(page2.locator('[data-chip="content"]')).toHaveAttribute('title', /partial clone.*path: search still works/);
    } finally {
      await other.close();
      await partial.stop();
    }
  });
});
