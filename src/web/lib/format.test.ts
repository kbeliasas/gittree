import { describe, expect, it } from 'vitest';

import { duration, fileSize, zonedTime } from './format.ts';

describe('format', () => {
  it('describes durations', () => {
    expect(duration(10)).toBe('1 minute');
    expect(duration(45 * 60)).toBe('45 minutes');
    expect(duration(5 * 3600)).toBe('5 hours');
    expect(duration(2 * 86_400)).toBe('2 days');
    expect(duration(70 * 86_400)).toBe('2 months');
    expect(duration(400 * 86_400)).toBe('1.1 years');
  });

  it('describes file sizes', () => {
    expect(fileSize(512)).toBe('512 B');
    expect(fileSize(2064)).toBe('2 KB');
    expect(fileSize(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });

  it("shows a time in the author's own zone", () => {
    const t = Date.UTC(2025, 0, 7, 9, 0) / 1000;
    expect(zonedTime(t, 120)).toBe('2025-01-07 11:00 +02:00');
    expect(zonedTime(t, -300)).toBe('2025-01-07 04:00 -05:00');
    expect(zonedTime(t, 330)).toBe('2025-01-07 14:30 +05:30');
  });
});
