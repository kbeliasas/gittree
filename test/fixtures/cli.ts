// `pnpm fixtures [dir]`: builds the fixture repositories for manual exploration,
// e.g. `pnpm dev test/fixtures/.repos/merges`.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildFixtures, FIXTURES_MARKER } from './build.ts';

const out = resolve(process.argv[2] ?? 'test/fixtures/.repos');
if (existsSync(out) && readdirSync(out).length > 0) {
  if (!existsSync(join(out, FIXTURES_MARKER))) {
    process.stderr.write(`Refusing to replace ${out}: it is not empty and was not created by pnpm fixtures.\n`);
    process.exit(1);
  }
  rmSync(out, { recursive: true, force: true });
}

const started = performance.now();
const fixtures = buildFixtures(out);
const ms = Math.round(performance.now() - started);
process.stdout.write(`Built ${Object.keys(fixtures.repos).length} repositories in ${fixtures.root} (${ms} ms):\n`);
for (const [name, repo] of Object.entries(fixtures.repos)) {
  process.stdout.write(`  ${name.padEnd(15)} ${repo.dir}\n`);
}
