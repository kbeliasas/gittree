import type { WebLink } from '../../shared/api.ts';
import type { GitRunner } from '../git/runner.ts';
import type { Repo } from './repo.ts';

/**
 * Where the repository's commits can be viewed on the web, from the URL of
 * `origin` (or else `upstream`, or else the first remote). Only a link is
 * built; no hosting API is called (PLAN §2: hosting APIs are out of v1).
 */
export async function readWebLink(git: GitRunner, repo: Repo, signal?: AbortSignal): Promise<WebLink | null> {
  const result = await git.run('config', {
    cwd: repo.path,
    signal,
    args: ['--get-regexp', '^remote\\..*\\.url$'],
    okExitCodes: [0, 1], // 1: no remotes
  });
  const remotes = new Map<string, string>();
  for (const line of result.stdout.toString('utf8').split('\n')) {
    const match = /^remote\.(.+)\.url (.+)$/.exec(line);
    if (match && !remotes.has(match[1]!)) remotes.set(match[1]!, match[2]!.trim());
  }
  const url = remotes.get('origin') ?? remotes.get('upstream') ?? remotes.values().next().value;
  return url === undefined ? null : webLinkFor(url);
}

interface Location {
  /** https, or http when the remote itself uses plain http. */
  scheme: 'https' | 'http';
  /** Host name, plus the port for http(s) remotes (SSH ports aren't web ports). */
  host: string;
  /** Repository path without leading slash and `.git`. */
  path: string;
}

/** Builds the commit-page template for a remote URL, or null for local paths and unknown hosts. */
export function webLinkFor(remoteUrl: string): WebLink | null {
  const location = parseRemote(remoteUrl);
  if (!location) return null;
  const { scheme, path } = location;
  const host = location.host.toLowerCase();
  const base = `${scheme}://${location.host}`;
  const name = host.split(':', 1)[0]!;

  if (name === 'ssh.dev.azure.com' || name === 'vs-ssh.visualstudio.com') {
    // v3/<org>/<project>/<repo>
    const [version, org, project, repoName] = path.split('/');
    if (version !== 'v3' || !org || !project || !repoName) return null;
    return { host: 'Azure DevOps', commitUrl: `https://dev.azure.com/${org}/${project}/_git/${repoName}/commit/{sha}` };
  }
  if (path.includes('/_git/')) return { host: 'Azure DevOps', commitUrl: `${base}/${path}/commit/{sha}` };
  if (name === 'bitbucket.org') return { host: 'Bitbucket', commitUrl: `${base}/${path}/commits/{sha}` };
  if (name.includes('bitbucket')) return bitbucketServer(base, path);
  if (name.includes('github')) return { host: 'GitHub', commitUrl: `${base}/${path}/commit/{sha}` };
  if (name.includes('gitlab')) return { host: 'GitLab', commitUrl: `${base}/${path}/-/commit/{sha}` };
  if (name === 'codeberg.org' || name.includes('gitea') || name.includes('forgejo')) {
    return { host: name === 'codeberg.org' ? 'Codeberg' : 'Gitea', commitUrl: `${base}/${path}/commit/{sha}` };
  }
  if (name === 'git.sr.ht') return { host: 'SourceHut', commitUrl: `${base}/${path}/commit/{sha}` };
  return null;
}

/** Bitbucket Server / Data Center: `scm/<project>/<repo>` (HTTP) or `<project>/<repo>` (SSH). */
function bitbucketServer(base: string, path: string): WebLink | null {
  const parts = path.split('/');
  if (parts[0] === 'scm') parts.shift();
  const [owner, repoName] = parts;
  if (!owner || !repoName || parts.length !== 2) return null;
  const commits = owner.startsWith('~')
    ? `${base}/users/${owner.slice(1)}/repos/${repoName}/commits/{sha}`
    : `${base}/projects/${owner.toUpperCase()}/repos/${repoName}/commits/{sha}`;
  return { host: 'Bitbucket', commitUrl: commits };
}

function parseRemote(remoteUrl: string): Location | null {
  const url = remoteUrl.trim();
  if (url === '') return null;

  // scp-like: [user@]host:path (no scheme; a slash before the colon makes it a local path).
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.+)$/.exec(url);
  if (scp && !url.includes('://')) {
    const host = scp[1]!;
    if (!host.includes('.') && host !== 'localhost') return null; // "C:\…" or a bare alias from ~/.ssh/config
    return location('https', host, scp[2]!);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.slice(0, -1);
  if (!['https', 'http', 'ssh', 'git', 'git+ssh', 'ssh+git'].includes(scheme) || parsed.hostname === '') return null;
  // User names and tokens in the URL never make it into a link; only web ports are kept.
  const web = scheme === 'http' || scheme === 'https';
  const host = web && parsed.port !== '' ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  return location(scheme === 'http' ? 'http' : 'https', host, parsed.pathname); // still percent-encoded, as a link needs it
}

function location(scheme: Location['scheme'], host: string, rawPath: string): Location | null {
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) return null; // only plain host names make it into a link
  const path = rawPath
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  if (path === '' || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  return { scheme, host, path };
}
