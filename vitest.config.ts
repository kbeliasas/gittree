import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // `pnpm fixtures` output contains repositories with their own *.test.ts files.
    exclude: [...configDefaults.exclude, 'test/fixtures/.repos/**'],
    environment: 'node',
    // Builds the fixture repositories once per run into a temp folder (KEEP_FIXTURES=1 keeps it).
    globalSetup: ['test/fixtures/global-setup.ts'],
    testTimeout: 20_000,
  },
});
