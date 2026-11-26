import { defineConfig, devices } from '@playwright/test';

// `pnpm test:e2e` builds first: the specs start the built CLI (dist/server/cli.js)
// against fixture repositories, exactly as a user would run gittree.
export default defineConfig({
  testDir: 'test/e2e',
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
