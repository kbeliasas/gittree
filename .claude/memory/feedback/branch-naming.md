---
name: branch-naming
description: Branches in this project are named feature/<short-name>; rename the session's claude/<generated> worktree branch before the first commit
keywords: [branch, naming, feature, git, worktree, rename, prefix]
source: user's request (2026-11-27)
updated: 2026-11-27
---

### Rule / Fact
Every branch in this project is named `feature/<short-name>`: a few lowercase kebab-case words saying what the
work is, e.g. `feature/no-lazy-fetch`. Fixes too.

### Why
The user asked for it for all branches in this project. New sessions still start on `claude/<generated-name>`:
the app's branch prefix (`branch_prefix`) is an account setting shared by every project, so it stays "claude".

### How to apply
- In a session worktree, once the task is clear and before the first commit, rename the branch:
  `git branch -m feature/<short-name>`. Check the name is free first (`git show-ref --verify refs/heads/<name>`).
- If the branch is already pushed or has a pull request, ask before renaming it on the remote.

Related: [[product-scope]]
