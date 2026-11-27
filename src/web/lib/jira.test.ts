import { describe, expect, it } from 'vitest';

import { jiraKeys, jiraMatcher, jiraUrl, linkify } from './jira.ts';

const keysIn = (text: string, projectKeys: string[] = []) => jiraMatcher(projectKeys)(text).map((m) => m.key);

describe('jiraMatcher', () => {
  it('finds keys in subjects, bodies and branch names', () => {
    expect(keysIn('SHOP-12 Add login form')).toEqual(['SHOP-12']);
    expect(keysIn('Store dates as ISO-8601 strings\n\nRefs SHOP-15 and OPS-7.')).toEqual(['SHOP-15', 'OPS-7']);
    expect(keysIn('feature/SHOP-123-login')).toEqual(['SHOP-123']);
    expect(keysIn('bugfix/SHOP-9_null-check')).toEqual(['SHOP-9']);
    expect(keysIn('Fix SHOP-12 login redirect (SHOP-12)')).toEqual(['SHOP-12', 'SHOP-12']);
  });

  it('skips look-alikes when no project keys are configured', () => {
    expect(keysIn('Switch file encoding to UTF-8')).toEqual([]);
    expect(keysIn('Use SHA-256 for checksums, see RFC-7231 and CVE-2024-1234')).toEqual([]);
    expect(keysIn('ISO-8601 dates; ES-2015 syntax; X-1 header')).toEqual([]);
  });

  it('ignores keys glued to other letters or digits, lowercase keys and zero-padded numbers', () => {
    expect(keysIn('XSHOP-12a SHOP-12a 1SHOP-3 shop-4 SHOP-007')).toEqual([]);
  });

  it('only matches configured project keys when there are some', () => {
    expect(keysIn('SHOP-1 OPS-2 ABC-3 UTF-8', ['SHOP', 'OPS'])).toEqual(['SHOP-1', 'OPS-2']);
    expect(keysIn('A.B-1 is not a key', ['A.B'])).toEqual(['A.B-1']); // keys are escaped, not regexes
  });
});

describe('jiraKeys', () => {
  it('lists distinct keys in order of appearance', () => {
    expect(jiraKeys(['SHOP-2 and OPS-1', 'feature/SHOP-2-x', 'OPS-9'], jiraMatcher([]))).toEqual(['SHOP-2', 'OPS-1', 'OPS-9']);
  });

  it('builds browse links', () => {
    expect(jiraUrl('https://acme.atlassian.net', 'SHOP-12')).toBe('https://acme.atlassian.net/browse/SHOP-12');
  });
});

describe('linkify', () => {
  const matcher = jiraMatcher(['SHOP']);

  it('splits text into plain runs, URLs and keys', () => {
    expect(linkify('SHOP-12: see https://example.com/docs.', matcher)).toEqual([
      { text: 'SHOP-12', key: 'SHOP-12', kind: 'jira' },
      { text: ': see ' },
      { text: 'https://example.com/docs', href: 'https://example.com/docs', kind: 'url' },
      { text: '.' },
    ]);
  });

  it('keeps keys inside URLs part of the URL, and balances parentheses', () => {
    expect(linkify('(https://jira.example.com/browse/SHOP-3)', matcher)).toEqual([
      { text: '(' },
      { text: 'https://jira.example.com/browse/SHOP-3', href: 'https://jira.example.com/browse/SHOP-3', kind: 'url' },
      { text: ')' },
    ]);
    expect(linkify('https://en.wikipedia.org/wiki/Git_(software)', matcher)).toHaveLength(1);
  });

  it('never links anything but http(s)', () => {
    expect(linkify('javascript:alert(1) ftp://x file:///etc', matcher)).toEqual([{ text: 'javascript:alert(1) ftp://x file:///etc' }]);
  });
});
