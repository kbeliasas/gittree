import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { FIXTURE_JIRA, type FixtureName } from '../fixtures/build.ts';
import { fixtures, startGittree, type Gittree } from './gittree.ts';

/** PLAN §11 E2E for M2: commit details, merged commits, Jira links, file list, diffs, conflict resolutions. */
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 900 } });

interface Session {
  gittree: Gittree;
  context: BrowserContext;
  page: Page;
  historyUrl: string;
}

async function open(browser: Browser, name: FixtureName): Promise<Session> {
  const gittree = await startGittree(fixtures.repos[name].dir);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(gittree.authUrl);
  await expect(page).toHaveURL(/\/r\/[0-9a-f]{12}\/history$/);
  return { gittree, context, page, historyUrl: page.url() };
}

async function close(session: Session | undefined): Promise<void> {
  await session?.context.close();
  await session?.gittree.stop();
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Selected commit' });
const diff = (page: Page) => page.getByRole('region', { name: 'Diff' });
const fileButton = (scope: Locator, path: string) => scope.locator(`button[data-path="${path}"]`);
const search = (page: Page, key: string) => new URL(page.url()).searchParams.get(key);

test.describe('merges', () => {
  const { shas } = fixtures.repos.merges;
  let s: Session;
  test.beforeAll(async ({ browser }) => {
    s = await open(browser, 'merges');
  });
  test.afterAll(() => close(s));

  test('a merge shows what it brought in, marks those commits and lights them up on hover', async () => {
    const { page } = s;
    await page.goto(`${s.historyUrl}?sel=${shas['merge-login']}`);
    const merged = panel(page).locator('[data-merged-summary]');
    await expect(merged).toHaveText('feature/SHOP-12-login: 2 commits over 2 days');
    await expect(page.locator('[role=option][data-merged]')).toHaveCount(2);
    await expect(page.locator('[role=option][data-merged]').first()).toContainText('SHOP-12 Login API client');

    await merged.hover();
    await expect(page.locator('[role=option]').filter({ hasText: 'SHOP-12 Add login form' })).not.toHaveAttribute('data-dim');
    await expect(page.locator(`[role=option][data-sha="${shas['merge-login']}"]`)).not.toHaveAttribute('data-dim');
    await expect(page.locator('[role=option]').filter({ hasText: 'Fix typo in README' })).toHaveAttribute('data-dim', 'true');
    await page.mouse.move(5, 5);
    await expect(page.locator('[role=option][data-dim]')).toHaveCount(0);
  });

  test('links Jira keys to the configured Jira', async () => {
    const { page } = s;
    const jira = panel(page).locator('a[data-jira-key="SHOP-12"]').first();
    await expect(jira).toHaveAttribute('href', `${FIXTURE_JIRA.baseUrl}/browse/SHOP-12`);
    await expect(panel(page).getByRole('link', { name: 'SHOP-12 ↗' })).toBeVisible();
  });

  test('lists the branches and tags that contain a commit', async () => {
    const { page } = s;
    await page.goto(`${s.historyUrl}?sel=${shas['cross-a1']}`);
    const contained = panel(page).locator('dt', { hasText: /^In$/ }).locator('xpath=following-sibling::dd[1]');
    await expect(contained.getByRole('button').first()).toHaveText('main'); // the default branch first
    await contained.getByRole('button', { name: /^\+\d+ more$/ }).click();
    await expect(contained).toContainText('cross/a');
    await expect(contained).toContainText('cross/b'); // the criss-cross merged it there too
    await expect(contained).toContainText('v1.1.0');
    await expect(contained).not.toContainText('feature/SHOP-12-login');
    await expect(contained).not.toContainText('feature/SHOP-15-cart'); // forked before the cross merges
  });

  test('switches a merge between its parents', async () => {
    const { page } = s;
    await page.goto(`${s.historyUrl}?sel=${shas['merge-login']}`);
    const files = panel(page).getByRole('region', { name: 'Changed files' });
    await expect(fileButton(files, 'notes/shop-12-add-login-form.md')).toBeVisible();
    await panel(page).getByRole('group', { name: 'Compare with' }).getByRole('button', { name: 'feature/SHOP-12-login' }).click();
    expect(search(page, 'parent')).toBe('2');
    await expect(fileButton(files, 'README.md')).toBeVisible();
    await expect(fileButton(files, 'notes/shop-12-add-login-form.md')).toHaveCount(0);
  });

  test('Enter opens the first file’s diff, Esc goes back; Back and Forward retrace it', async () => {
    const { page } = s;
    await page.goto(`${s.historyUrl}?sel=${shas.root}`);
    await page.locator('[data-commit-list]').focus();
    await page.keyboard.press('Enter');
    await expect(diff(page)).toBeVisible();
    expect(search(page, 'file')).toBe('README.md');
    await expect(diff(page).getByRole('heading', { level: 3 })).toHaveText('README.md');
    await expect(page.getByLabel('Changes in README.md')).toContainText('# Shop');

    await page.keyboard.press('Escape');
    await expect(diff(page)).toHaveCount(0);
    expect(search(page, 'file')).toBeNull();
    await page.goBack();
    await expect(diff(page)).toBeVisible();
    await page.goForward();
    await expect(panel(page)).toBeVisible();
  });
});

test.describe('files', () => {
  const { shas } = fixtures.repos.files;
  let s: Session;
  test.beforeAll(async ({ browser }) => {
    s = await open(browser, 'files');
  });
  test.afterAll(() => close(s));

  test('click a file: the panel widens into its diff, highlighted, with word-level changes', async () => {
    const { page } = s;
    await page.goto(`${s.historyUrl}?sel=${shas.head}`);
    await fileButton(panel(page), 'src/api/login.ts').click();
    await expect(diff(page)).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    const body = page.getByLabel('Changes in src/api/login.ts');
    await expect(body).toHaveAttribute('data-highlighted', 'typescript');
    await expect(body.locator('.tok').first()).toBeVisible();
    // AUTH_VERSION 2 → 3: only the digit is a word change.
    await expect(body.locator('.bg-rose-200\\/80, .bg-emerald-200\\/80').first()).toBeVisible();
    // 14 unchanged lines between the two changes are folded; a click unfolds them.
    const fold = body.locator('[data-fold]');
    await expect(fold).toContainText('14 unchanged lines');
    await fold.getByRole('button', { name: /Show all 14/ }).click();
    await expect(body.locator('[data-fold]')).toHaveCount(0);
  });

  test('split or unified, remembered across reloads', async () => {
    const { page } = s;
    const body = page.getByLabel('Changes in src/api/login.ts');
    await page.getByRole('group', { name: 'Diff layout' }).getByRole('button', { name: 'Unified' }).click();
    await expect(body).toHaveAttribute('data-diff-mode', 'unified');
    await page.reload();
    await expect(page.getByLabel('Changes in src/api/login.ts')).toHaveAttribute('data-diff-mode', 'unified');
    await page.getByRole('group', { name: 'Diff layout' }).getByRole('button', { name: 'Split' }).click();
    await expect(page.getByLabel('Changes in src/api/login.ts')).toHaveAttribute('data-diff-mode', 'split');
  });

  test('j and k step through the files; a large diff waits for "Load diff"', async () => {
    const { page } = s;
    await page.keyboard.press('k');
    expect(search(page, 'file')).toBe('data/big.csv');
    await expect(diff(page)).toContainText('Large diff: 6,000 changed lines');
    await diff(page).getByRole('button', { name: 'Load diff' }).click();
    await expect(page.getByLabel('Changes in data/big.csv').locator('[data-line]').first()).toBeVisible();
    await page.keyboard.press('j');
    expect(search(page, 'file')).toBe('src/api/login.ts');
  });

  test('renames, binary files and mode changes say what happened', async () => {
    const { page } = s;
    await page.goto(`${s.historyUrl}?sel=${shas.rename}&file=src%2Fapi%2Flogin.ts`);
    await expect(diff(page).getByRole('heading', { level: 3 })).toHaveText('src/auth.ts → src/api/login.ts');
    await expect(diff(page)).toContainText('94% similar');

    await page.goto(`${s.historyUrl}?sel=${shas.binary}&file=assets%2Flogo.png`);
    await expect(diff(page)).toContainText('Binary file — not shown.');

    await page.goto(`${s.historyUrl}?sel=${shas['mode-change']}&file=scripts%2Fbuild.sh`);
    await expect(diff(page)).toContainText('Only the file mode changed: 100644 → 100755 (executable).');
  });

  test('[ and ] move between commits with the diff open, on the same file where it changed', async () => {
    const { page } = s;
    await page.goto(`${s.historyUrl}?sel=${shas.head}&file=src%2Fapi%2Flogin.ts`);
    await expect(page.getByLabel('Changes in src/api/login.ts')).toBeVisible();
    await page.keyboard.press('[');
    await expect(page).toHaveURL(new RegExp(`sel=${shas.large}`));
    // "Add generated data" doesn't change login.ts: its own first file opens instead.
    await expect.poll(() => search(page, 'file')).toBe('data/big.csv');
    await page.keyboard.press(']');
    await expect(page).toHaveURL(new RegExp(`sel=${shas.head}`));
    expect(search(page, 'file')).toBe('data/big.csv'); // the head commit changes it too
  });

  test('with a diff open, the arrow keys keep stepping commits while the commit list has the focus', async () => {
    const { page } = s;
    await page.goto(`${s.historyUrl}?sel=${shas.head}&file=src%2Fapi%2Flogin.ts`);
    await page.locator(`[role=option][data-sha="${shas.head}"]`).click();
    for (const label of ['large', 'delete', 'symlink']) {
      await page.keyboard.press('ArrowDown');
      await expect(page).toHaveURL(new RegExp(`sel=${shas[label]}`));
      await expect(diff(page)).toBeVisible();
    }
  });
});

test.describe('conflicts', () => {
  const { shas } = fixtures.repos.conflicts;
  let s: Session;
  test.beforeAll(async ({ browser }) => {
    s = await open(browser, 'conflicts');
  });
  test.afterAll(() => close(s));

  test('links the commit to its page on the hosting service', async () => {
    const { page } = s;
    await page.goto(`${s.historyUrl}?sel=${shas['conflict-merge']}`);
    await expect(panel(page).getByRole('link', { name: 'GitHub ↗' })).toHaveAttribute(
      'href',
      `https://github.com/example/shop/commit/${shas['conflict-merge']}`,
    );
  });

  test('shows only the conflict resolutions, with a marker column per parent', async () => {
    const { page } = s;
    await panel(page).getByRole('group', { name: 'Compare with' }).getByRole('button', { name: 'conflicts' }).click();
    const files = panel(page).getByRole('region', { name: 'Changed files' });
    await expect(files.locator('button[data-path]')).toHaveText([/NOTES\.md/, /retry\.ts/]);
    await fileButton(files, 'src/retry.ts').click();
    const body = page.getByLabel('Conflict resolutions in src/retry.ts');
    await expect(body.locator('[data-line="add"]')).toContainText('attempts: 4,');
    await expect(body.locator('[data-line="del"]')).toHaveCount(2);
    await expect(diff(page).getByRole('group', { name: 'Diff layout' }).getByRole('button', { name: 'Split' })).toBeDisabled();
  });

  test('ignores whitespace on request', async () => {
    const { page } = s;
    await page.goto(`${s.historyUrl}?sel=${shas.head}&file=src%2Flimits.ts`);
    await expect(page.getByLabel('Changes in src/limits.ts').locator('[data-line]').first()).toBeVisible();
    await diff(page).getByLabel('Ignore whitespace').check();
    expect(search(page, 'ws')).toBe('1');
    await expect(diff(page)).toContainText('No changes when whitespace is ignored.');
  });
});
