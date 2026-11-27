import { execFileSync } from 'node:child_process';

import { compareVersions, parseGitVersion } from '../../src/server/git/version.ts';

/**
 * Whether the installed git honours GIT_NO_LAZY_FETCH (2.44+). Older git ignores it and downloads
 * what the partial-clone fixtures lack, changing them for every test that shares them, so tests
 * that read file contents from those fixtures are skipped.
 */
export const NO_LAZY_FETCH_SUPPORTED: boolean = (() => {
  const version = parseGitVersion(execFileSync('git', ['version'], { encoding: 'utf8' }));
  return version !== null && compareVersions(version, [2, 44, 0]) >= 0;
})();
