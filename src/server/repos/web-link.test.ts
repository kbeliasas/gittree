import { describe, expect, it } from 'vitest';

import { webLinkFor } from './web-link.ts';

describe('webLinkFor', () => {
  it.each([
    ['git@github.com:owner/repo.git', 'GitHub', 'https://github.com/owner/repo/commit/{sha}'],
    ['https://github.com/owner/repo.git', 'GitHub', 'https://github.com/owner/repo/commit/{sha}'],
    ['https://github.com/owner/repo/', 'GitHub', 'https://github.com/owner/repo/commit/{sha}'],
    ['ssh://git@github.com/owner/repo.git', 'GitHub', 'https://github.com/owner/repo/commit/{sha}'],
    ['git@github.example.com:team/app.git', 'GitHub', 'https://github.example.com/team/app/commit/{sha}'],
    ['git@gitlab.com:group/sub/repo.git', 'GitLab', 'https://gitlab.com/group/sub/repo/-/commit/{sha}'],
    ['https://gitlab.acme.io:8443/group/repo.git', 'GitLab', 'https://gitlab.acme.io:8443/group/repo/-/commit/{sha}'],
    ['git@bitbucket.org:team/repo.git', 'Bitbucket', 'https://bitbucket.org/team/repo/commits/{sha}'],
    [
      'ssh://git@bitbucket.acme.com:7999/proj/repo.git',
      'Bitbucket',
      'https://bitbucket.acme.com/projects/PROJ/repos/repo/commits/{sha}',
    ],
    [
      'https://bitbucket.acme.com/scm/proj/repo.git',
      'Bitbucket',
      'https://bitbucket.acme.com/projects/PROJ/repos/repo/commits/{sha}',
    ],
    [
      'https://bitbucket.acme.com/scm/~jane/dotfiles.git',
      'Bitbucket',
      'https://bitbucket.acme.com/users/jane/repos/dotfiles/commits/{sha}',
    ],
    ['git@ssh.dev.azure.com:v3/org/project/repo', 'Azure DevOps', 'https://dev.azure.com/org/project/_git/repo/commit/{sha}'],
    ['https://org@dev.azure.com/org/project/_git/repo', 'Azure DevOps', 'https://dev.azure.com/org/project/_git/repo/commit/{sha}'],
    ['https://codeberg.org/owner/repo.git', 'Codeberg', 'https://codeberg.org/owner/repo/commit/{sha}'],
    ['https://git.sr.ht/~owner/repo', 'SourceHut', 'https://git.sr.ht/~owner/repo/commit/{sha}'],
    ['http://gitea.lan:3000/owner/repo.git', 'Gitea', 'http://gitea.lan:3000/owner/repo/commit/{sha}'],
  ])('%s → %s', (url, host, commitUrl) => {
    expect(webLinkFor(url)).toEqual({ host, commitUrl });
  });

  it('never puts user names or tokens into the link', () => {
    expect(webLinkFor('https://jane:ghp_secret@github.com/owner/repo.git')?.commitUrl).toBe('https://github.com/owner/repo/commit/{sha}');
  });

  it.each([
    ['a local path', '/srv/git/repo.git'],
    ['a relative path', '../linear'],
    ['a file URL', 'file:///srv/git/repo.git'],
    ['a Windows path', 'C:\\repos\\app'],
    ['an SSH host alias', 'work:owner/repo.git'],
    ['an unknown host', 'git@git.example.com:owner/repo.git'],
    ['a host with odd characters', 'git@github.com"x:owner/repo.git'],
    ['no repository path', 'https://github.com/'],
    ['an empty URL', ''],
  ])('ignores %s', (_, url) => {
    expect(webLinkFor(url)).toBeNull();
  });
});
