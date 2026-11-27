import { describe, expect, it } from 'vitest';

import { parseSearch, stringifySearch, validateHistorySearch } from './search.ts';

const roundTrip = (search: Record<string, unknown>) => validateHistorySearch(parseSearch(stringifySearch(search)));

describe('history search params', () => {
  it('round-trips every field', () => {
    const search = { sel: 'a1b2c3d', order: 'topo', focus: 'feature/x', parent: 'cc', file: 'odd/new\nline.txt', ws: true } as const;
    expect(roundTrip(search)).toEqual(search);
    expect(roundTrip({ parent: 2 })).toEqual({ parent: 2 });
    expect(stringifySearch({ ws: true, file: 'a b.txt', focus: undefined })).toBe('?ws=1&file=a+b.txt');
    expect(stringifySearch({})).toBe('');
  });

  it('keeps all-digit hashes as text', () => {
    expect(roundTrip({ sel: '1234567' })).toEqual({ sel: '1234567' });
  });

  it('drops values it does not understand', () => {
    expect(validateHistorySearch({ sel: 'HEAD', order: 'random', parent: '1', ws: 'yes', file: '' })).toEqual({});
    expect(validateHistorySearch({ parent: '65' })).toEqual({});
    expect(validateHistorySearch({ parent: '64' })).toEqual({ parent: 64 });
  });
});
