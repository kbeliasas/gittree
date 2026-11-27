const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export const numberFormat = new Intl.NumberFormat('en-US');

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** Compact age for list columns: "now", "5m", "3h", "2d", "7mo", "2y". */
export function shortAge(seconds: number, now = Date.now() / 1000): string {
  const age = Math.max(0, now - seconds);
  if (age < MINUTE) return 'now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < MONTH) return `${Math.floor(age / DAY)}d`;
  if (age < YEAR) return `${Math.floor(age / MONTH)}mo`;
  return `${Math.floor(age / YEAR)}y`;
}

/** "2 hours ago", "last month". */
export function longAge(seconds: number, now = Date.now() / 1000): string {
  const age = seconds - now;
  const abs = Math.abs(age);
  if (abs < MINUTE) return 'just now';
  if (abs < HOUR) return relativeFormat.format(Math.trunc(age / MINUTE), 'minute');
  if (abs < DAY) return relativeFormat.format(Math.trunc(age / HOUR), 'hour');
  if (abs < MONTH) return relativeFormat.format(Math.trunc(age / DAY), 'day');
  if (abs < YEAR) return relativeFormat.format(Math.trunc(age / MONTH), 'month');
  return relativeFormat.format(Math.trunc(age / YEAR), 'year');
}

export function dateTime(seconds: number): string {
  return dateTimeFormat.format(seconds * 1000);
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${numberFormat.format(count)} ${count === 1 ? one : many}`;
}

/** A span of time in words: "45 minutes", "3 days", "2 months". */
export function duration(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < HOUR) return plural(Math.max(1, Math.round(s / MINUTE)), 'minute');
  if (s < DAY) return plural(Math.round(s / HOUR), 'hour');
  if (s < MONTH) return plural(Math.round(s / DAY), 'day');
  if (s < YEAR) return plural(Math.round(s / MONTH), 'month');
  return plural(Math.round((s / YEAR) * 10) / 10, 'year');
}

const sizeFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** "512 B", "2.1 KB", "3.4 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} KB`;
  return `${sizeFormat.format(bytes / 1024 / 1024)} MB`;
}

/** The time as its author saw it: "2025-01-07 11:00 +02:00" (`tz` in minutes east of UTC). */
export function zonedTime(seconds: number, tz: number): string {
  const shifted = new Date((seconds + tz * 60) * 1000).toISOString(); // the wall-clock time, labelled UTC
  const sign = tz < 0 ? '-' : '+';
  const abs = Math.abs(tz);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 16)} ${offset}`;
}
