---
name: toolchain-gotchas
description: Silent failure modes in gittree's tooling (pnpm 12 release age and skill approvals, no pnpm link --global, Playwright skipping typecheck, TanStack's streamedQuery export, fixture .repos, browser-pane keys and previews)
keywords: [gotchas, pnpm, approve, skills, link, global, symlink, install, typecheck, dom, playwright, tanstack, streamedQuery, vitest, fixtures, browser, preview, keyboard]
updated: 2026-11-27
---

### Rule / Fact
- **pnpm 12** enforces a minimum release age (it installs a slightly older version than `npm view` shows) and holds
  packages that ship agent "skills" for approval. tsdown's and @tanstack/react-router's skills are deliberately
  unapproved; the build doesn't need them. Installing third-party agent skills into the project is the user's call —
  don't `pnpm approve --all`.
- **pnpm 12 has no `pnpm link --global`.** Put `gittree` on PATH by symlinking `dist/server/cli.js` into a PATH folder
  (`~/.local/bin` here). Node runs the link's real path, so `findWebRoot` and runtime deps resolve inside the repo.
  After code changes, `pnpm build` again; no re-link needed.
- **Playwright doesn't type-check specs**, and the root tsconfig has no DOM lib: a DOM type name such as
  `HTMLInputElement` in `test/e2e` passes Playwright but breaks `pnpm typecheck`. Run typecheck after editing specs;
  check DOM properties structurally (`'selectionStart' in el`). `pnpm exec playwright test` runs the last build:
  `pnpm test:e2e <spec>` rebuilds first.
- TanStack Query 5.108 exports `streamedQuery` only as `experimental_streamedQuery`.
- `test/fixtures/.repos` (from `pnpm fixtures`) contains `*.test.ts` files; Vitest and tsconfig exclude it.
- **Browser pane:** the `computer` tool's `key bracketright` / `type ]` deliver no `[`/`]` keydown to the page, and
  focus events don't fire while the pane's window lacks focus (`document.hasFocus()` false). Check such keys and
  focus-driven UI with `javascript_tool` or in Playwright E2E. Previews (`.claude/launch.json`) read the fixture's own
  gittree config, not `~/.config/gittree`.

### Why
Each symptom points somewhere else (odd versions, a red typecheck after green E2E, UI that "doesn't react"), so they
are easy to misdiagnose.

### How to apply
- An "old" version after `pnpm add` is the release-age policy, not a resolution bug.
- After E2E edits: `pnpm typecheck` as well as the specs.

Related: [[build-and-runtime-gotchas]], [[product-scope]]
