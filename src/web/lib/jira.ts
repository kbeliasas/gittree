/**
 * Jira keys in commit messages and branch names (PLAN §8). With project keys
 * configured, only those match; without, a generic KEY-123 pattern minus
 * look-alikes such as UTF-8, SHA-256 or ISO-8601.
 */
export interface JiraMatch {
  key: string;
  start: number;
  end: number;
}

export type JiraMatcher = (text: string) => JiraMatch[];

/** Prefixes of things that look like issue keys but aren't. */
const NOT_JIRA = new Set([
  'AES',
  'ANSI',
  'ARM',
  'BASE',
  'CP',
  'CVE',
  'CWE',
  'DDR',
  'DES',
  'ECMA',
  'ES',
  'GPT',
  'HTTP',
  'IEC',
  'IEEE',
  'IPV',
  'ISO',
  'JEP',
  'JSR',
  'LATIN',
  'LTE',
  'MD',
  'PCI',
  'PEP',
  'RFC',
  'RSA',
  'SHA',
  'SSL',
  'TLS',
  'UCS',
  'USB',
  'UTF',
  'WIN',
  'X',
]);

const NUMBER = '[1-9]\\d{0,6}';
// Not glued to a preceding letter or digit, nor followed by one: `feature/SHOP-12-login`
// and `SHOP-12_fix` match, `XSHOP-12` and `SHOP-12a` don't.
const BEFORE = '(?<![A-Za-z0-9])';
const AFTER = '(?![A-Za-z0-9])';

export function jiraMatcher(projectKeys: readonly string[]): JiraMatcher {
  const pattern =
    projectKeys.length > 0
      ? new RegExp(`${BEFORE}(?:${projectKeys.map(escapeRegExp).join('|')})-${NUMBER}${AFTER}`, 'g')
      : new RegExp(`${BEFORE}([A-Z][A-Z0-9]{1,9})-${NUMBER}${AFTER}`, 'g');
  const generic = projectKeys.length === 0;
  return (text) => {
    const matches: JiraMatch[] = [];
    for (const match of text.matchAll(pattern)) {
      if (generic && NOT_JIRA.has(match[1]!)) continue;
      matches.push({ key: match[0], start: match.index, end: match.index + match[0].length });
    }
    return matches;
  };
}

/** Distinct keys across texts, in order of first appearance. */
export function jiraKeys(texts: readonly string[], matcher: JiraMatcher): string[] {
  const keys = new Set<string>();
  for (const text of texts) for (const match of matcher(text)) keys.add(match.key);
  return [...keys];
}

export function jiraUrl(baseUrl: string, key: string): string {
  return `${baseUrl}/browse/${encodeURIComponent(key)}`;
}

/** A piece of message text: plain, a web link, or a Jira key (a link when a base URL is set). */
export type Segment = { text: string } | { text: string; href: string; kind: 'url' } | { text: string; key: string; kind: 'jira' };

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/g;

/** Splits text into plain runs, http(s) links and Jira keys. Nothing else becomes a link. */
export function linkify(text: string, matcher: JiraMatcher): Segment[] {
  const marks: Array<{ start: number; end: number; segment: Segment }> = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    // Trailing punctuation usually ends the sentence, not the URL; a ")" closes a parenthesis unless the URL opened one.
    let url = match[0].replace(/[.,;:!?]+$/, '');
    while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
    marks.push({ start: match.index, end: match.index + url.length, segment: { text: url, href: url, kind: 'url' } });
  }
  for (const match of matcher(text)) {
    if (marks.some((m) => match.start < m.end && m.start < match.end)) continue; // inside a URL
    marks.push({ start: match.start, end: match.end, segment: { text: match.key, key: match.key, kind: 'jira' } });
  }
  marks.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let offset = 0;
  for (const mark of marks) {
    if (mark.start > offset) segments.push({ text: text.slice(offset, mark.start) });
    segments.push(mark.segment);
    offset = mark.end;
  }
  if (offset < text.length) segments.push({ text: text.slice(offset) });
  return segments;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
