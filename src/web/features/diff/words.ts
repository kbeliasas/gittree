/** A changed part of a line: [start, end) in UTF-16 code units. */
export interface Range {
  start: number;
  end: number;
}

/** Letters and digits stay together, runs of spaces too; everything else is a token of its own. */
const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
/** Above this many token pairs the quadratic comparison isn't worth it. */
const MAX_CELLS = 250_000;
/** Lines sharing less than this fraction of their text are shown as whole-line changes. */
const MIN_SHARED = 0.3;

/**
 * Word-level changes between a removed and an added line (PLAN §8 diff viewer):
 * the tokens outside their longest common subsequence. Null when the lines are
 * too different (or too long) for word highlights to help.
 */
export function wordDiff(a: string, b: string): { a: Range[]; b: Range[] } | null {
  if (a === b) return { a: [], b: [] };
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length * tb.length > MAX_CELLS) return null;

  // lcs[i][j] = length of the LCS of ta[i..] and tb[j..], flattened.
  const width = tb.length + 1;
  const lcs = new Uint32Array((ta.length + 1) * width);
  for (let i = ta.length - 1; i >= 0; i--) {
    for (let j = tb.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        ta[i]!.text === tb[j]!.text ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }

  const keepA = new Uint8Array(ta.length);
  const keepB = new Uint8Array(tb.length);
  let shared = 0;
  for (let i = 0, j = 0; i < ta.length && j < tb.length; ) {
    if (ta[i]!.text === tb[j]!.text) {
      keepA[i] = 1;
      keepB[j] = 1;
      shared += ta[i]!.text.length;
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  if (shared < MIN_SHARED * Math.max(a.length, b.length)) return null;
  return { a: changedRanges(ta, keepA), b: changedRanges(tb, keepB) };
}

interface Token {
  text: string;
  start: number;
}

function tokens(text: string): Token[] {
  return [...text.matchAll(TOKEN)].map((match) => ({ text: match[0], start: match.index }));
}

/** Ranges of the tokens not kept; changes separated only by whitespace are joined. */
function changedRanges(list: readonly Token[], keep: Uint8Array): Range[] {
  const ranges: Range[] = [];
  let previous = -1; // index of the last changed token
  for (let i = 0; i < list.length; i++) {
    if (keep[i]) continue;
    const token = list[i]!;
    const end = token.start + token.text.length;
    let onlySpaces = previous >= 0;
    for (let k = previous + 1; onlySpaces && k < i; k++) onlySpaces = /^\s+$/.test(list[k]!.text);
    if (onlySpaces) ranges.at(-1)!.end = end;
    else ranges.push({ start: token.start, end });
    previous = i;
  }
  return ranges;
}
