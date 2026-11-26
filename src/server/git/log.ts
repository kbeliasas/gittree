/** One commit as the history graph needs it. */
export interface LogRecord {
  sha: string;
  /** First parent first; empty for root commits and for the boundary commits of a shallow clone. */
  parents: string[];
  /** After .mailmap. */
  authorName: string;
  authorEmail: string;
  /** Unix seconds. */
  authorTime: number;
  commitTime: number;
  subject: string;
}

/**
 * `git log` format for the graph: seven fields, each terminated by a NUL (git adds a
 * newline after every record). A NUL can't occur inside a field, so no subject
 * content can shift the fields, whatever control characters it contains.
 */
export const GRAPH_LOG_FORMAT = '--format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%ct%x00%s%x00';
const FIELDS = 7;

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function parseGraphLog(output: string): LogRecord[] {
  const tokens = output.split('\0');
  // Whatever follows the last NUL is the final record's newline (or '' for no output).
  const fieldCount = tokens.length - 1;
  if (fieldCount % FIELDS !== 0 || (tokens.at(-1) ?? '').trim() !== '') {
    throw new Error(`unexpected git log output: ${fieldCount} fields is not a multiple of ${FIELDS}`);
  }

  const records: LogRecord[] = [];
  for (let i = 0; i < fieldCount; i += FIELDS) {
    const [rawSha = '', parents = '', authorName = '', authorEmail = '', authorTime = '', commitTime = '', subject = ''] =
      tokens.slice(i, i + FIELDS);
    const sha = rawSha.startsWith('\n') ? rawSha.slice(1) : rawSha;
    const parentList = parents === '' ? [] : parents.split(' ');
    if (!SHA.test(sha) || !parentList.every((p) => SHA.test(p))) {
      throw new Error(`unexpected git log output near commit ${JSON.stringify(sha.slice(0, 64))}`);
    }
    records.push({
      sha,
      parents: parentList,
      authorName,
      authorEmail,
      authorTime: toSeconds(authorTime),
      commitTime: toSeconds(commitTime),
      subject,
    });
  }
  return records;
}

function toSeconds(value: string): number {
  const seconds = Number.parseInt(value, 10);
  return Number.isSafeInteger(seconds) ? seconds : 0;
}
