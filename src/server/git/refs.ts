import type { RefKind } from '../../shared/api.ts';

export interface ParsedRef {
  /** Short name: "main", "origin/main", "v1.2.0". */
  name: string;
  kind: RefKind;
  /** The commit it points at (annotated tags peeled). */
  commit: string;
  /** Short name of the tracked branch, e.g. "origin/main". */
  upstream?: string;
  upstreamGone?: true;
}

export interface ParsedRefs {
  refs: ParsedRef[];
  /** Where `origin/HEAD` points, e.g. "origin/main": the remote's default branch. */
  originHead: string | null;
}

/** Ref namespaces the graph shows. */
export const REF_PATTERNS = ['refs/heads', 'refs/remotes', 'refs/tags'] as const;

/** `git for-each-ref` format: eight NUL-separated fields, one ref per line (ref names can't contain either). */
export const REFS_FORMAT =
  '--format=%(refname)%00%(objecttype)%00%(objectname)%00%(*objecttype)%00%(*objectname)%00%(upstream)%00%(upstream:track)%00%(symref)';
const FIELDS = 8;

const PREFIXES: ReadonlyArray<readonly [string, RefKind]> = [
  ['refs/heads/', 'local'],
  ['refs/remotes/', 'remote'],
  ['refs/tags/', 'tag'],
];

export function parseRefs(output: string): ParsedRefs {
  const refs: ParsedRef[] = [];
  let originHead: string | null = null;

  for (const line of output.split('\n')) {
    if (line === '') continue;
    const fields = line.split('\0');
    if (fields.length !== FIELDS) throw new Error(`unexpected git for-each-ref output: ${JSON.stringify(line)}`);
    const [refname = '', type, object = '', peeledType, peeled = '', upstream = '', track = '', symref = ''] = fields;

    const prefix = PREFIXES.find(([p]) => refname.startsWith(p));
    if (!prefix) continue;
    const [prefixText, kind] = prefix;
    const name = refname.slice(prefixText.length);

    if (symref !== '') {
      // Symbolic refs aren't shown; origin/HEAD names the remote's default branch.
      if (refname === 'refs/remotes/origin/HEAD' && symref.startsWith('refs/remotes/')) {
        originHead = symref.slice('refs/remotes/'.length);
      }
      continue;
    }

    // Tags may point at trees or blobs, and nested tags peel only one level: skip what isn't a commit.
    const commit = type === 'commit' ? object : type === 'tag' && peeledType === 'commit' ? peeled : null;
    if (!commit) continue;

    const ref: ParsedRef = { name, kind, commit };
    if (kind !== 'tag' && upstream !== '') {
      ref.upstream = shortBranchName(upstream);
      if (track === '[gone]') ref.upstreamGone = true;
    }
    refs.push(ref);
  }
  return { refs, originHead };
}

function shortBranchName(refname: string): string {
  for (const prefix of ['refs/remotes/', 'refs/heads/']) {
    if (refname.startsWith(prefix)) return refname.slice(prefix.length);
  }
  return refname;
}
