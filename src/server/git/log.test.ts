import { describe, expect, it } from 'vitest';

import { parseGraphLog } from './log.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

/** What `git log` prints for GRAPH_LOG_FORMAT: NUL-terminated fields, a newline after each record. */
const record = (fields: string[]) => `${fields.map((f) => `${f}\0`).join('')}\n`;

describe('parseGraphLog', () => {
  it('parses records with merges, roots and identities after .mailmap', () => {
    const output =
      record([A, `${B} ${C}`, 'Alice Smith', 'alice@example.com', '1736154000', '1736157600', "Merge branch 'x'"]) +
      record([B, C, 'Bob', 'bob@example.com', '1736150000', '1736150000', 'Add x']) +
      record([C, '', 'Zoë Ångström', 'zoe@example.com', '1736140000', '1736140000', 'Initial commit']);

    expect(parseGraphLog(output)).toEqual([
      {
        sha: A,
        parents: [B, C],
        authorName: 'Alice Smith',
        authorEmail: 'alice@example.com',
        authorTime: 1736154000,
        commitTime: 1736157600,
        subject: "Merge branch 'x'",
      },
      expect.objectContaining({ sha: B, parents: [C] }),
      expect.objectContaining({ sha: C, parents: [], authorName: 'Zoë Ångström' }),
    ]);
  });

  it('keeps subjects with newlines, record separators and other control characters intact', () => {
    const subject = 'weird \u001e subject \n with \u001f stuff';
    const [parsed] = parseGraphLog(record([A, '', 'n', 'e', '1', '2', subject]) + record([B, '', 'n', 'e', '1', '2', 'next']));
    expect(parsed?.subject).toBe(subject);
  });

  it('accepts SHA-256 object ids', () => {
    const long = 'd'.repeat(64);
    expect(parseGraphLog(record([long, '', 'n', 'e', '1', '2', 's']))[0]?.sha).toBe(long);
  });

  it('returns nothing for empty output', () => {
    expect(parseGraphLog('')).toEqual([]);
  });

  it('rejects output that does not match the format', () => {
    expect(() => parseGraphLog(`${A}\0${B}\0`)).toThrow(/multiple of 7/);
    expect(() => parseGraphLog(record(['nope', '', 'n', 'e', '1', '2', 's']))).toThrow(/unexpected git log output/);
  });
});
