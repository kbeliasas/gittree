---
name: commit-identity
description: Commits in gittree are authored with the kbeliasas GitHub no-reply email so they link to that account
keywords: [git, commit, author, committer, email, identity, github, kbeliasas, noreply, user.email]
source: user, 2026-11-27
updated: 2026-11-27
---

### Rule / Fact
Every new commit in this repo is authored and committed as
`Karolis Beliasas <35032624+kbeliasas@users.noreply.github.com>`, the no-reply address of the **kbeliasas** GitHub
account that owns the repo. It is set as `user.email` in the repo's shared `.git/config`, so every worktree inherits
it; the global `user.email` stays as is for other repos.

### Why
The user wants commits here credited to the kbeliasas account. The no-reply form `<id>+<login>@users.noreply.github.com`
always links to that account, whatever emails it has verified, and keeps a personal address out of the public history.
The rule covers new commits only ("all other commits"): existing commits are not rewritten.

### How to apply
- In a new clone, cloud session or on another machine, run
  `git config user.email 35032624+kbeliasas@users.noreply.github.com` before the first commit.
- Check with `git var GIT_AUTHOR_IDENT` when unsure. Don't override it with `--author`, `-c user.email=…` or
  `GIT_AUTHOR_EMAIL`.
- `extensions.worktreeConfig` is on, so a `user.email` in a worktree's `config.worktree` would win. Don't set one.

Related: [[branch-naming]]
