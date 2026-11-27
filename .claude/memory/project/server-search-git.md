---
name: server-search-git
description: Verified git behaviors behind gittree's path:/content:/regex: search (diff-tree --stdin echo, -c merge headers, :(glob) vs literal pathspecs, -S/-G with -i, invalid regex, partial clones)
keywords: [search, diff-tree, stdin, pickaxe, -S, -G, regex, glob, pathspec, literal, combined, merge, partial, objects_missing, ndjson]
updated: 2026-11-27
---

### Rule / Fact
- Server search = the graph page's commits fed to `git diff-tree --stdin -r --root --no-renames --name-only
  --format=%x01%H` in batches (`src/server/search/search.ts`); a commit matches when a file name follows its header.
- **`diff-tree --stdin` echoes any line that isn't a full object id**, abbreviated hashes included, without
  diffing it. Feed full ids only (from `rev-list`).
- **With `-c`, a merge's header prints even when its combined diff is empty** (TREESAME to one parent): don't
  count headers, count headers followed by a name. `-c --name-only` lists files differing from *every* parent,
  so clean "brought-in" merges drop out, conflict resolutions and merge-only edits stay. Without `-c`/`-m`,
  diff-tree skips merges (what `content:`/`regex:` want).
- **`:(glob)` only works with `GIT_LITERAL_PATHSPECS` off**; with it on, the magic is a literal file name and
  matches nothing. The runner's `literalPathspecs: false` turns it off for one command. `:(glob)*.md` is
  top-level only, `**/*.md` anywhere; a `[...]` glob also matches the literal name. A folder pathspec, with or
  without trailing `/`, matches what's inside; `sr` doesn't match `src/`.
- `-S`/`-G` honor `-i`. A bad `-G` regex (POSIX ERE) exits 128 with `fatal: invalid regex: <reason>` → 400
  `bad_regex`. `-S<text>`/`-G<re>` stay one argv element, so user text can't act as an option.
- Partial clones: path search needs trees only and works; `-S`/`-G` fail with `could not fetch <oid> from
  promisor remote` (partial.ts detects it) → 409 `objects_missing`, raised from the first batch before streaming.

### Why
Each was probed on fixtures and a scratch repo while building M3 part 2; the wrong assumption fails silently
(empty or inflated match sets) rather than with an error.

### How to apply
- Re-check the matching bullet before changing the diff-tree options, the parser or the glob handling.
- Fixture `conflicts` covers the merge cases, `files` odd paths and globs, `partial` the 409.

Related: [[git-diff-gotchas]], [[partial-clone-lazy-fetch]]
