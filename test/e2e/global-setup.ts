import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildFixtures } from '../fixtures/build.ts';

/** Builds the fixture repositories and hands their description to the specs through the environment. */
export default function globalSetup(): () => void {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'gittree-e2e-'));
  process.env.GITTREE_E2E_FIXTURES = JSON.stringify(buildFixtures(root));
  return () => rmSync(root, { recursive: true, force: true });
}
