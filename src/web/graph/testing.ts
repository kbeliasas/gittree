import type { RefKind } from '../../shared/api.ts';
import { analyzeGraph, type GraphAnalysis } from './analyze.ts';
import { renderAscii } from './ascii.ts';
import { withChildren, type DagWithChildren, type GraphInput } from './dag.ts';

/** Test helpers: graphs written as text, and random histories. Not used by the app. */

export interface RefSpec {
  at: string;
  kind?: RefKind;
  upstream?: string;
}

export interface Built {
  input: GraphInput;
  dag: DagWithChildren;
  rows: string[];
  row: (name: string) => number;
  analysis: GraphAnalysis;
  ascii: () => string;
}

/**
 * A graph from lines like `M: C B` (commit M with parents C and B), newest
 * first. Parents that aren't listed become unloaded parents. Ref kinds default
 * to remote for `origin/…`, tag for `v…`, local otherwise.
 */
export function build(
  spec: string,
  refs: Record<string, string | RefSpec> = {},
  options: { defaultBranch?: string | null; head?: string; headBranch?: string | null; subjects?: Record<string, string> } = {},
): Built {
  const entries = spec
    .trim()
    .split('\n')
    .map((line) => {
      const [name = '', parents = ''] = line.split(':').map((part) => part.trim());
      return { name, parents: parents === '' ? [] : parents.split(/\s+/) };
    });
  const rows = entries.map((e) => e.name);
  const rowOf = new Map(rows.map((name, row) => [name, row]));
  const unloaded = new Map<string, number>();
  const count = rows.length;

  const parentStart = new Int32Array(count + 1);
  const parentIdx: number[] = [];
  entries.forEach((entry, row) => {
    parentStart[row] = parentIdx.length;
    for (const parent of entry.parents) {
      let index = rowOf.get(parent);
      if (index === undefined) {
        index = unloaded.get(parent) ?? count + unloaded.size;
        unloaded.set(parent, index);
      }
      if (index <= row) throw new Error(`${entry.name}: parent ${parent} must come after it`);
      parentIdx.push(index);
    }
  });
  parentStart[count] = parentIdx.length;

  const refList = Object.entries(refs).map(([name, value]) => {
    const ref = typeof value === 'string' ? { at: value } : value;
    const kind: RefKind = ref.kind ?? (name.startsWith('origin/') ? 'remote' : /^v\d/.test(name) ? 'tag' : 'local');
    const commit = rowOf.get(ref.at);
    if (commit === undefined) throw new Error(`ref ${name} points at unknown commit ${ref.at}`);
    return { name, kind, commit, ...(ref.upstream ? { upstream: ref.upstream } : {}) };
  });

  const mergeSubjects = new Map<number, string>();
  entries.forEach((entry, row) => {
    if (entry.parents.length > 1) mergeSubjects.set(row, options.subjects?.[entry.name] ?? `Merge into ${entry.name}`);
  });

  const headRow = options.head === undefined ? -1 : (rowOf.get(options.head) ?? -1);
  const input: GraphInput = {
    count,
    parentStart,
    parentIdx: Int32Array.from(parentIdx),
    refs: refList,
    defaultBranch: options.defaultBranch === undefined ? (refList.some((r) => r.name === 'main') ? 'main' : null) : options.defaultBranch,
    head: { row: headRow, branch: options.headBranch ?? null },
    mergeSubjects,
  };
  const analysis = analyzeGraph(input);
  const refsAt = (row: number) => refList.filter((r) => r.commit === row).map((r) => r.name);

  return {
    input,
    dag: withChildren(input),
    rows,
    row: (name) => {
      const row = rowOf.get(name);
      if (row === undefined) throw new Error(`no commit ${name}`);
      return row;
    },
    analysis,
    ascii: () =>
      renderAscii(
        analysis.layout,
        entries.map((entry, row) => ({ subject: entry.name, refs: refsAt(row), merge: entry.parents.length > 1 })),
      ),
  };
}

/** mulberry32: a tiny seeded random number generator. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A plausible random history: feature branches forking from and merging into
 * main (most deleted after merging), back-merges, octopus merges, criss-crosses
 * and the odd unrelated root. Rows newest first.
 */
export function randomHistory(size: number, seed: number): GraphInput {
  const random = seededRandom(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const created: number[][] = [[]];
  const subjects: string[] = ['Initial commit'];
  const heads = new Map<string, number>([['main', 0]]);
  let next = 1;

  const add = (parents: number[], subject: string) => {
    created.push(parents);
    subjects.push(subject);
    return created.length - 1;
  };

  while (created.length < size) {
    const roll = random();
    const names = [...heads.keys()];
    const others = names.filter((name) => name !== 'main');
    if (roll < 0.07 && heads.size < 40) {
      const from = random() < 0.75 ? heads.get('main')! : heads.get(pick(names))!;
      const name = `feature/f${next++}`;
      heads.set(name, add([from], `Start ${name}`));
    } else if (roll < 0.15 && others.length > 0) {
      const source = pick(others);
      const into = random() < 0.85 ? 'main' : pick(names);
      if (into === source) continue;
      const parents = [heads.get(into)!, heads.get(source)!];
      if (random() < 0.08 && others.length > 2) {
        const extra = heads.get(pick(others))!;
        if (!parents.includes(extra)) parents.push(extra);
      }
      heads.set(into, add(parents, `Merge branch '${source}'`));
      if (into === 'main' && random() < 0.75) heads.delete(source);
    } else if (roll < 0.17 && others.length > 0) {
      const branch = pick(others);
      if (heads.get(branch) === heads.get('main')) continue;
      heads.set(branch, add([heads.get(branch)!, heads.get('main')!], `Merge branch 'main' into ${branch}`));
    } else if (roll < 0.172) {
      heads.set(`orphan/o${next++}`, add([], 'Unrelated root'));
    } else {
      const name = pick(names);
      heads.set(name, add([heads.get(name)!], `Work on ${name}`));
    }
  }

  // Creation order reversed is a valid topological order: children before parents.
  const count = created.length;
  const rowOf = (index: number) => count - 1 - index;
  const parentStart = new Int32Array(count + 1);
  const parentIdx: number[] = [];
  const mergeSubjects = new Map<number, string>();
  for (let row = 0; row < count; row++) {
    const index = count - 1 - row;
    parentStart[row] = parentIdx.length;
    for (const parent of created[index]!) parentIdx.push(rowOf(parent));
    if (created[index]!.length > 1) mergeSubjects.set(row, subjects[index]!);
  }
  parentStart[count] = parentIdx.length;

  return {
    count,
    parentStart,
    parentIdx: Int32Array.from(parentIdx),
    refs: [...heads].map(([name, index]) => ({ name, kind: 'local' as const, commit: rowOf(index) })),
    defaultBranch: 'main',
    head: { row: rowOf(heads.get('main')!), branch: 'main' },
    mergeSubjects,
  };
}
