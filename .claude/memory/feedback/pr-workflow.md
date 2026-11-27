---
name: pr-workflow
description: main is protected; every change goes feature branch → PR → the user merges; Claude never pushes to main or merges
keywords: [pr, pull-request, main, protected, ruleset, branch-protection, merge, approval, review, feature-branch, push]
source: user, 2026-11-27
updated: 2026-11-27
---

### Rule / Fact
`main` on GitHub (kbeliasas/gittree) is protected by the ruleset **Protect main** (id 28236384): no direct pushes,
no force pushes, no deletion. Changes land only through a pull request with 1 approval, and new commits dismiss
earlier approvals. The owner, kbeliasas, is on the bypass list **for pull requests only**: they can merge a PR
without the approval, but they can't push to main either.

So every change goes: `feature/<short-name>` branch → push it → open a PR to main → the user reviews and merges.
Claude never pushes to main and never merges a PR.

### Why
The user wants every change approved by them, the maintainer. GitHub never lets a PR's author approve it, and
Claude pushes and opens PRs as kbeliasas, so for Claude's PRs the user's own merge (through the bypass) is the
approval. PRs from anyone else (forks, Dependabot) need their real approval. Rejected: having Claude use a separate
GitHub account so GitHub enforces the approval itself (more setup for the same result).

### How to apply
- Start work on a feature branch ([[branch-naming]]) and commit with the kbeliasas identity ([[commit-identity]]).
- A commit made on local main by mistake can't be pushed: move it to a feature branch first (ask before resetting
  main).
- To merge their own PR, the user ticks "Merge without waiting for requirements to be met (bypass rules)".
- Check what's enforced: `curl -s https://api.github.com/repos/kbeliasas/gittree/rules/branches/main`. Edit it in
  Settings → Rulesets → Protect main.

Related: [[branch-naming]], [[commit-identity]]
