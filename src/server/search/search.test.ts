import { describe, expect, inject, it } from 'vitest';

import type { SearchEvent } from '../../shared/api.ts';
import { GitRunner } from '../git/runner.ts';
import { readSnapshot } from '../graph/graph.ts';
import { resolveRepo } from '../repos/repo.ts';
import { filterFor, parseMatches, startSearch, type SearchTerm } from './search.ts';

const fixtures = inject('fixtures');
const git = new GitRunner();
const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

describe('parseMatches', () => {
  it('counts a commit once it has a file, and not a merge whose combined diff is empty', () => {
    const output = `\x01${SHA1}\n\n\x01${SHA2}\n\nsrc/a.ts\nsrc/b.ts\n`;
    expect(parseMatches(output)).toEqual([SHA2]);
    expect(parseMatches('')).toEqual([]);
    expect(parseMatches(`\x01${'c'.repeat(64)}\n\nREADME.md\n`)).toEqual(['c'.repeat(64)]);
  });

  it('refuses output it does not understand', () => {
    expect(() => parseMatches('\x01HEAD\n')).toThrow(/unexpected git diff-tree output/);
  });
});

describe('filterFor', () => {
  const term = (kind: SearchTerm['kind'], value: string, ignoreCase = false): SearchTerm => ({ kind, value, ignoreCase });

  it('passes paths after --, literally unless they have glob characters', () => {
    expect(filterFor(term('path', 'src/a[1].ts'))).toMatchObject({ paths: [':(glob)src/a[1].ts'], literalPathspecs: false });
    expect(filterFor(term('path', './src'))).toMatchObject({ paths: ['src'], literalPathspecs: true });
    expect(filterFor(term('path', '/'))).toMatchObject({ paths: ['.'] });
    expect(filterFor(term('path', ':(top)x'))).toMatchObject({ paths: [':(top)x'], literalPathspecs: true });
  });

  it('attaches texts to their option, so they never act as options themselves', () => {
    expect(filterFor(term('content', '--output=/tmp/x')).args).toContain('-S--output=/tmp/x');
    expect(filterFor(term('regex', 'a|b', true)).args.slice(-2)).toEqual(['-Ga|b', '-i']);
  });
});

describe('startSearch', () => {
  const merges = fixtures.repos.merges;

  async function run(term: SearchTerm, tuning = { firstBatch: 3, batch: 4, parallel: 2 }, signal = new AbortController().signal) {
    const repo = await resolveRepo(git, merges.dir);
    const snapshot = await readSnapshot(git, repo);
    return startSearch(git, repo, snapshot, term, { order: 'date', limit: 10_000 }, signal, tuning);
  }
  const collect = async (events: AsyncIterable<SearchEvent>) => {
    const list: SearchEvent[] = [];
    for await (const event of events) list.push(event);
    return list;
  };

  it('searches in batches, several at once, reporting each as progress', async () => {
    const term: SearchTerm = { kind: 'path', value: 'notes', ignoreCase: false };
    const batched = await collect((await run(term)).events);
    const whole = await collect((await run(term, { firstBatch: 100, batch: 100, parallel: 1 })).events);

    const progress = batched.filter((e) => e.type === 'progress');
    expect(progress).toHaveLength(1 + Math.ceil((24 - 3) / 4)); // the first batch, then batches of four
    expect(progress.map((e) => e.searched)).toEqual([...progress.map((e) => e.searched)].sort((a, b) => a - b));
    expect(batched.at(-1)).toEqual({ type: 'done', searched: 24, total: 24 });
    const found = (events: SearchEvent[]) => events.flatMap((e) => (e.type === 'progress' ? e.matches : [])).sort();
    expect(found(batched)).toEqual(found(whole));
    expect(found(whole).length).toBeGreaterThan(10);
  });

  it('stops when its signal aborts, without a last event', async () => {
    const controller = new AbortController();
    const { events } = await run({ kind: 'content', value: 'Cart', ignoreCase: false }, { firstBatch: 2, batch: 2, parallel: 1 }, controller.signal);
    const first = await events.next();
    expect(first.value).toMatchObject({ type: 'progress', searched: 2 });
    controller.abort();
    const rest = await collect({ [Symbol.asyncIterator]: () => events });
    expect(rest.filter((e) => e.type !== 'progress')).toEqual([]);
    expect(rest.length).toBeLessThan(11);
  });
});
