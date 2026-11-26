import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TestProject } from 'vitest/node';

import { buildFixtures, type Fixtures } from './build.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    fixtures: Fixtures;
  }
}

export default function setup(project: TestProject): () => void {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'gittree-fixtures-'));
  project.provide('fixtures', buildFixtures(root));
  return () => {
    if (process.env.KEEP_FIXTURES) process.stdout.write(`Fixtures kept in ${root}\n`);
    else rmSync(root, { recursive: true, force: true });
  };
}
