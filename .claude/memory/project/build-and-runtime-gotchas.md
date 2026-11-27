---
name: build-and-runtime-gotchas
description: Silent failure modes in gittree's server and git runner (macOS git shim, git process kills, Fastify static/zod, same-site localhost, Playwright CORS events, rev-parse --end-of-options)
keywords: [gotchas, git, xcrun, shim, process-group, kill, fastify, static, zod, validation, same-site, cookie, guard, playwright, cors, end-of-options]
updated: 2026-11-27
---

### Rule / Fact
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

### Why
Each symptom points somewhere else (slow tests, unexplained 403s, missing events), so they are easy to misdiagnose;
most of the workarounds look arbitrary without the reason.

### How to apply
- Re-read the matching bullet before touching the runner's kill logic, the static plugin options, the guard's
  Sec-Fetch-Site rule or the validation error mapping.

Related: [[toolchain-gotchas]], [[git-diff-gotchas]], [[product-scope]]
