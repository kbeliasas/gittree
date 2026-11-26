import { describe, expect, it } from 'vitest';

import { pickDefaultBranch } from '../graph/graph.ts';
import { parseRefs, type ParsedRef } from './refs.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const T = 't'.repeat(40);

/** One for-each-ref line in REFS_FORMAT order. */
const line = (refname: string, type: string, object: string, extra: Partial<Record<'peeledType' | 'peeled' | 'upstream' | 'track' | 'symref', string>> = {}) =>
  [refname, type, object, extra.peeledType ?? '', extra.peeled ?? '', extra.upstream ?? '', extra.track ?? '', extra.symref ?? ''].join('\0');

describe('parseRefs', () => {
  it('classifies branches, remote branches and tags, peeling annotated tags', () => {
    const output = [
      line('refs/heads/main', 'commit', A, { upstream: 'refs/remotes/origin/main', track: '[ahead 1]' }),
      line('refs/heads/bugfix/null-check', 'commit', B, { upstream: 'refs/remotes/origin/bugfix/null-check', track: '[gone]' }),
      line('refs/heads/stacked', 'commit', B, { upstream: 'refs/heads/main' }),
      line('refs/remotes/origin/HEAD', 'commit', A, { symref: 'refs/remotes/origin/main' }),
      line('refs/remotes/origin/main', 'commit', A),
      line('refs/tags/v1.0.0', 'tag', T, { peeledType: 'commit', peeled: B }),
      line('refs/tags/v1.1.0', 'commit', A),
      line('refs/tags/tree-tag', 'tag', T, { peeledType: 'tree', peeled: 'e'.repeat(40) }),
      line('refs/tags/blob', 'blob', 'f'.repeat(40)),
      '',
    ].join('\n');

    expect(parseRefs(output)).toEqual({
      originHead: 'origin/main',
      refs: [
        { name: 'main', kind: 'local', commit: A, upstream: 'origin/main' },
        { name: 'bugfix/null-check', kind: 'local', commit: B, upstream: 'origin/bugfix/null-check', upstreamGone: true },
        { name: 'stacked', kind: 'local', commit: B, upstream: 'main' },
        { name: 'origin/main', kind: 'remote', commit: A },
        { name: 'v1.0.0', kind: 'tag', commit: B },
        { name: 'v1.1.0', kind: 'tag', commit: A },
      ],
    });
  });

  it('rejects lines with the wrong number of fields', () => {
    expect(() => parseRefs('refs/heads/main\0commit\n')).toThrow(/unexpected git for-each-ref output/);
  });
});

describe('pickDefaultBranch', () => {
  const ref = (name: string, kind: ParsedRef['kind'] = 'local'): ParsedRef => ({ name, kind, commit: A });

  it('follows origin/HEAD, preferring the local branch of the same name', () => {
    expect(pickDefaultBranch([ref('trunk'), ref('origin/trunk', 'remote'), ref('main')], 'origin/trunk', 'main')).toBe('trunk');
    expect(pickDefaultBranch([ref('main'), ref('origin/trunk', 'remote')], 'origin/trunk', 'main')).toBe('origin/trunk');
  });

  it('falls back to main, master, develop, then HEAD, then any branch', () => {
    expect(pickDefaultBranch([ref('develop'), ref('master')], null, null)).toBe('master');
    expect(pickDefaultBranch([ref('feature'), ref('origin/develop', 'remote')], null, 'feature')).toBe('origin/develop');
    expect(pickDefaultBranch([ref('zeta'), ref('alpha')], null, 'zeta')).toBe('zeta');
    expect(pickDefaultBranch([ref('zeta'), ref('alpha')], null, null)).toBe('alpha');
    expect(pickDefaultBranch([ref('v1', 'tag')], null, null)).toBeNull();
  });
});
