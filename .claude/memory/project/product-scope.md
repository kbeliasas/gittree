---
name: product-scope
description: Agreed v1 scope and hard constraints for the gittree git-history explorer, incl. features the user deliberately left out
keywords: [scope, decisions, stack, read-only, fetch, local, v1, deferred, plan, pnpm, tsdown, playwright]
source: user's answers in the planning Q&A and at the start of M0, 2026-11-26
updated: 2026-11-26
---

### Rule / Fact
- Personal local tool: `gittree [path]` → Node server on 127.0.0.1 → browser; repos read from disk via the git CLI.
- Read-only except one explicit Fetch (`git fetch --all --prune`). No checkout/branch/merge/rebase actions.
- Target repos < 10k commits (whole graph in one request, layout in a browser worker).
- Stack: TypeScript, React + Vite, Node + Fastify. Main view: vertical lanes + commit list, details/diff panel right.
- Tooling: **pnpm, never npm**; tsdown builds the server; Playwright runs its own pinned Chromium, not system Chrome.
- Full plan, milestones and defaults: `PLAN.md` at the repo root.

### Why
Chosen by the user in the planning Q&A. Deliberately left out of v1: compare branches / two commits, minimap,
time-travel playback, live file-watching refresh, graph export, hosting APIs, clone-by-URL, browser-only mode,
write actions, multi-user hosting. Tooling picks at M0 start: pnpm (user's correction mid-task), tsdown because
tsup's README now marks it unmaintained, pinned Chromium for reproducible E2E runs.

### How to apply
- Treat any left-out feature or any new git write operation as a scope change: ask first, then update PLAN.md.
- Keep the git runner allowlisted and read-only; fetch is the only exception.
