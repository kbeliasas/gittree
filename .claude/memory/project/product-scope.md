---
name: product-scope
description: Agreed v1 scope and hard constraints for the gittree git-history explorer, incl. features the user deliberately left out and the M2/M3 picks
keywords: [scope, decisions, stack, read-only, fetch, local, v1, deferred, plan, pnpm, tsdown, playwright, m3, search, glob, first-parent, pr-split]
source: user's answers in the planning Q&A and at the start of M0 (2026-11-26), M2 and M3 (2026-11-27)
updated: 2026-11-27
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
M2 Q&A (2026-11-27): Jira settings come from `~/.config/gittree/config.json` by hand until M4; selecting a merge marks
its merged commits without dimming; own diff renderer instead of @git-diff-view/react. Extras taken into v1: the `--cc`
conflict-resolution view and a "view on GitHub/…" link. Offered and declined: image previews of binary files, a
full-file-at-commit view (overlaps M6's Files view). Details of all of it live in PLAN.md §6–§9.
M3 Q&A (2026-11-27): M3 lands as **three PRs in sequence** — (1) search bar + in-browser filters + dim/hide,
(2) server `path:`/`content:`/`regex:` search, (3) branch visibility, first-parent, topology-only — each started only
after the user merges the previous one. `path:` uses git globs only when the value has `*`, `?` or `[`, else literal.
First-parent follows one branch (the default, or the focused one), not every visible branch. Extras taken: negated
tokens (`-author:bob`), search suggestions, a Jira ticket list. Declined: remembering branch picks per repo in the browser.

### How to apply
- Treat any left-out or declined feature or any new git write operation as a scope change: ask first, then update PLAN.md.
- Keep the git runner allowlisted and read-only; fetch is the only exception.
