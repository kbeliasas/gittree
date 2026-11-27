/**
 * GIT_* variables passed through from the user's environment: where their own
 * config lives, how to reach remotes (SSH/HTTP/proxy/TLS settings for fetch),
 * and tracing. Everything else starting with GIT_ is dropped, so a stray
 * GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_CONFIG_PARAMETERS, … in the shell
 * that launched gittree can't redirect or reconfigure the commands we run.
 */
const PASSTHROUGH =
  /^GIT_(?:CONFIG_GLOBAL|CONFIG_SYSTEM|CONFIG_NOSYSTEM|EXEC_PATH|SSH|SSH_COMMAND|SSH_VARIANT|ASKPASS|SSL_\w+|HTTP_\w+|PROXY_\w+|CURL_\w+|TRACE\w*)$/;

/**
 * `-c` overrides applied to every command. They keep output machine-readable
 * whatever the user's own config says.
 */
export const BASE_CONFIG: readonly string[] = [
  'core.quotepath=off', // paths as UTF-8, not "\303\244" escapes
  'core.pager=cat',
  'core.fsmonitor=false', // never start or query an fsmonitor daemon
  'color.ui=false',
  'log.showSignature=false', // no gpg output mixed into log/show
  'log.follow=false', // following renames is an explicit choice per request
  'i18n.logOutputEncoding=UTF-8',
  'diff.noprefix=false',
  'diff.mnemonicPrefix=false',
];

export function gitEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (key.startsWith('GIT_') && !PASSTHROUGH.test(key)) continue;
    env[key] = value;
  }
  return {
    ...env,
    GIT_OPTIONAL_LOCKS: '0', // never take index.lock for opportunistic refreshes while your IDE works
    GIT_TERMINAL_PROMPT: '0', // fail instead of waiting for a username or password
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    GIT_EDITOR: 'false', // nothing gittree runs should open an editor; fail fast if one tries
    // Paths gittree passes are file names from git's own output: `*`, `?`, `[` and a leading `:` must
    // not turn them into globs or pathspec magic (`a[1].txt` would otherwise also match `a1.txt`).
    GIT_LITERAL_PATHSPECS: '1',
    LC_ALL: 'C', // stable, untranslated messages
  };
}
