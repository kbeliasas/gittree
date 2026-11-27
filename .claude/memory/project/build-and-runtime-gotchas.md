---
name: build-and-runtime-gotchas
description: Silent failure modes in gittree's toolchain and server (pnpm 12, global CLI link, macOS git shim, git process kills, Fastify static/zod, same-site localhost, Playwright CORS events, browser-pane keys)
keywords: [gotchas, pnpm, approve, skills, link, global, symlink, path, install, git, xcrun, shim, process-group, fastify, static, zod, validation, same-site, cookie, playwright, cors, vitest, fixtures, browser, preview, keyboard]
updated: 2026-11-27
---

### Rule / Fact
- **pnpm 12** enforces a minimum release age (it installs a slightly older version than `npm view` shows) and holds
  packages that ship agent "skills" for approval. tsdown's and @tanstack/react-router's skills are deliberately
  unapproved; the build doesn't need them. Installing third-party agent skills into the project is the user's call —
  don't `pnpm approve --all`.
- **pnpm 12 has no `pnpm link --global`.** Put `gittree` on PATH by symlinking `dist/server/cli.js` into a PATH folder
  (`~/.local/bin` here). Works from any folder: Node runs the link's real path, so `findWebRoot` and runtime deps
  resolve inside the repo. After code changes, `pnpm build` again; no re-link needed.
- **macOS `/usr/bin/git` is an xcrun shim** (~10 ms extra per spawn). App and fixture builder run
  `$(git --exec-path)/git` instead (`src/server/git/binary.ts`).
- **Stopping git means killing its process group**: helpers (ssh, textconv) keep stdout open, and a plain kill made a
  timeout take 10 s. The runner spawns `detached` and signals `-pid`.
- **@fastify/static with `index: false` answers `/` with 403.** Keep `index: 'index.html'`.
- **Errors from the custom zod validator** reach the error handler as `code: 'FST_ERR_VALIDATION'` without `.validation`.
- **Another port on 127.0.0.1 is same-site**, so SameSite=Strict cookies are sent from other local servers. The guard
  rejects `Sec-Fetch-Site: same-site` except page navigations, and cookie names include the port.
- **Chromium emits no Playwright `response` event for a CORS-blocked fetch.** E2E asserts the server's refusal from
  `gittree --verbose` request lines instead.
- `git rev-parse --end-of-options` with nothing after it echoes the flag; the runner adds it only when there are revs.
- `test/fixtures/.repos` (from `pnpm fixtures`) contains `*.test.ts` files; Vitest and tsconfig exclude it.
- **Browser pane key presses:** the `computer` tool's `key bracketright` / `type ]` deliver no `[`/`]` keydown to the
  page. Check those keys with `javascript_tool` (`dispatchEvent(new KeyboardEvent('keydown', {key: ']'}))`) or in
  Playwright E2E. Previews (`.claude/launch.json`) read the fixture's own gittree config, not `~/.config/gittree`.

### Why
Each symptom points somewhere else (slow tests, unexplained 403s, missing events, odd versions), so they are easy to
misdiagnose; most of the workarounds look arbitrary without the reason.

### How to apply
- Re-read the matching bullet before touching the runner's kill logic, the static plugin options, the guard's
  Sec-Fetch-Site rule or the validation error mapping.
- An "old" version after `pnpm add` is the release-age policy, not a resolution bug.

Related: [[product-scope]], [[git-diff-gotchas]]
