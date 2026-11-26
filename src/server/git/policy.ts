import { GitError } from './errors.ts';

/**
 * The git subcommands gittree may run. All are read-only; `fetch` is the one
 * deliberate write (it only updates remote-tracking refs and FETCH_HEAD) and is
 * reachable only through a dedicated runner method, never through `run()`.
 * Anything else is refused before a process is spawned.
 */
export const READ_SUBCOMMANDS = [
  'log',
  'show',
  'diff',
  'diff-tree',
  'rev-parse',
  'rev-list',
  'for-each-ref',
  'ls-tree',
  'cat-file',
  'blame',
  'cherry',
  'symbolic-ref',
  'config',
  'version',
] as const;

export type ReadSubcommand = (typeof READ_SUBCOMMANDS)[number];
export type Subcommand = ReadSubcommand | 'fetch';

export interface ArgParts {
  /** Options written by gittree's own code, e.g. `--format=%H`. Never user input. */
  args: readonly string[];
  /** User-influenced revisions; they go after `--end-of-options`. */
  revs: readonly string[];
  /** User-influenced paths; they go after `--`. */
  paths: readonly string[];
}

const READ_SET: ReadonlySet<string> = new Set(READ_SUBCOMMANDS);

/**
 * Long options that would make an otherwise read-only command write a file,
 * run an external diff program, or read files outside the repository. Git
 * accepts unambiguous abbreviations (`--outp`), so prefixes are matched too.
 */
const FORBIDDEN_LONG_OPTIONS = ['output', 'ext-diff', 'no-index'];

export function assertAllowed(sub: string, parts: ArgParts, opts: { allowWrite: boolean }): void {
  if (sub === 'fetch') {
    if (!opts.allowWrite) throw disallowed('git fetch is only available through the dedicated fetch method');
  } else if (!READ_SET.has(sub)) {
    throw disallowed(`git ${sub} is not on gittree's allowlist`);
  }

  for (const arg of parts.args) {
    if (arg.includes('\0')) throw disallowed('arguments must not contain NUL bytes');
    const forbidden = forbiddenLongOption(arg);
    if (forbidden) throw disallowed(`option --${forbidden} is not allowed`);
  }
  for (const rev of parts.revs) {
    if (rev === '' || rev.startsWith('-') || /[\0\r\n]/.test(rev)) {
      throw disallowed(`invalid revision ${JSON.stringify(rev)}`);
    }
  }
  for (const path of parts.paths) {
    if (path === '' || path.includes('\0')) throw disallowed(`invalid path ${JSON.stringify(path)}`);
  }

  SUBCOMMAND_RULES[sub]?.(parts);
}

function forbiddenLongOption(arg: string): string | undefined {
  if (!arg.startsWith('--') || arg === '--') return undefined;
  const name = arg.slice(2).split('=', 1)[0] ?? '';
  // Git needs at least a few characters to resolve an abbreviation unambiguously.
  if (name.length < 3) return undefined;
  return FORBIDDEN_LONG_OPTIONS.find((option) => option.startsWith(name));
}

type Rule = (parts: ArgParts) => void;

const CONFIG_READ_MODES: ReadonlySet<string> = new Set(['--get', '--get-all', '--get-regexp']);
const CONFIG_SAFE_FLAG =
  /^(?:--null|-z|--bool|--int|--path|--bool-or-int|--type=[a-z-]+|--default=.*|--local|--global|--system|--includes|--no-includes|--show-origin|--show-scope|--name-only)$/;

const SYMBOLIC_REF_SAFE_FLAG = /^(?:-q|--quiet|--short|--no-recurse)$/;
const FETCH_SAFE_FLAG = /^(?:--all|--prune|--progress|--quiet|--verbose)$/;

const SUBCOMMAND_RULES: Partial<Record<string, Rule>> = {
  // Only `config --get[-all|-regexp] <key> [<value-pattern>]`: never set, unset or edit.
  config: ({ args, revs }) => {
    const flags = args.filter((a) => a.startsWith('-'));
    const positionals = [...args.filter((a) => !a.startsWith('-')), ...revs];
    const modes = flags.filter((f) => CONFIG_READ_MODES.has(f));
    const unsafe = flags.find((f) => !CONFIG_READ_MODES.has(f) && !CONFIG_SAFE_FLAG.test(f));
    if (modes.length !== 1 || unsafe !== undefined || positionals.length < 1 || positionals.length > 2) {
      throw disallowed('git config is limited to --get, --get-all and --get-regexp lookups');
    }
  },
  // Reading takes one name; two names (or -d) would point HEAD somewhere else.
  'symbolic-ref': ({ args, revs }) => {
    const flags = args.filter((a) => a.startsWith('-'));
    const positionals = [...args.filter((a) => !a.startsWith('-')), ...revs];
    if (flags.some((f) => !SYMBOLIC_REF_SAFE_FLAG.test(f)) || positionals.length !== 1) {
      throw disallowed('git symbolic-ref may only read a single ref');
    }
  },
  // Fixed shape: no remote names, refspecs or --upload-pack style options.
  fetch: ({ args, revs, paths }) => {
    if (args.some((a) => !FETCH_SAFE_FLAG.test(a)) || revs.length > 0 || paths.length > 0) {
      throw disallowed('git fetch only accepts --all, --prune, --progress, --quiet and --verbose');
    }
  },
};

function disallowed(message: string): GitError {
  return new GitError('GIT_DISALLOWED', message);
}
