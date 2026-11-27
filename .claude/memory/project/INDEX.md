# project/

- [product-scope](product-scope.md) — v1 scope (local read-only+fetch, <10k commits, TS React+Node, pnpm, tsdown) + M2/M3 picks (M3 = 3 sequential PRs, path globs, first-parent) and declined extras. tags: scope, stack, read-only, deferred-features, tooling, m2, m3
- [build-and-runtime-gotchas](build-and-runtime-gotchas.md) — macOS git shim, process-group kill, Fastify static 403, zod validation errors, same-site localhost, Playwright CORS events. tags: gotchas, git, fastify, guard, playwright
- [toolchain-gotchas](toolchain-gotchas.md) — pnpm 12 release age/approvals, no link --global, Playwright skips typecheck (no DOM lib), streamedQuery export, browser-pane keys/focus. tags: gotchas, pnpm, typecheck, playwright, tanstack, preview
- [git-diff-gotchas](git-diff-gotchas.md) — --cc file lists, diff-tree commit-id line, log on trees/tags, literal pathspecs, quoted patch paths, full-context -U. tags: git, diff, cc, merge, pathspec
- [partial-clone-lazy-fetch](partial-clone-lazy-fetch.md) — git downloads missing objects in partial clones; GIT_NO_LAZY_FETCH, failure wordings, details fallback, 409 objects_missing, fixtures. tags: partial, blobless, promisor, read-only, offline
- [server-search-git](server-search-git.md) — path:/content:/regex: via diff-tree --stdin: echoed ids, -c merge headers, :(glob) needs literal off, -S/-G -i, bad regex, partial 409. tags: search, diff-tree, pickaxe, glob, pathspec
