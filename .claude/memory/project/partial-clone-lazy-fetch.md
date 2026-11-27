---
name: partial-clone-lazy-fetch
description: Partial clones make git download missing objects on demand (lazy fetch); gittree blocks it with GIT_NO_LAZY_FETCH and turns the failures into 409 objects_missing
keywords: [partial clone, blobless, filter, lazy fetch, promisor, GIT_NO_LAZY_FETCH, objects_missing, read-only, offline, mailmap, uploadpack, allowFilter]
updated: 2026-11-27
---

### Rule / Fact
- In a partial clone (`--filter=blob:none`) git downloads missing objects whenever a command needs them, writing a
  new promisor pack and then starting `git maintenance --auto`. Verified triggers (git 2.50): `diff-tree --numstat`,
  `-M` and `-p` (one batched fetch), `cat-file --batch-check` (one fetch per missing blob), `diff-tree --cc`, and in
  a bare clone `log --format=%aN` reading `HEAD:.mailmap`, i.e. the graph route.
- The runner sets `GIT_NO_LAZY_FETCH=1` (git 2.44+; older git ignores it and still downloads). git then fails in
  one of two wordings: diffs that prefetch say `fatal: could not fetch <oid> from promisor remote` (after a "lazy
  fetching disabled" warning); direct reads (`--cc`) say `fatal: unable to read <oid>`, which counts as missing only
  in a partial clone. `src/server/git/partial.ts` classifies; `commit.ts` answers 409 `objects_missing` with a git
  command that would download the contents.
- Not failures: `cat-file --batch-check` prints `<oid> missing` (exit 0); `log` with an unreadable `HEAD:.mailmap`
  prints an error, exits 0 and skips the mailmap, so bare partial clones show unmapped author names.
- `diff-tree --raw --no-renames` needs no file contents; `-M` does (inexact rename detection).
- A partial clone is marked by `remote.<name>.promisor=true` (all git 2.50 writes) or `extensions.partialClone`.

### Why
gittree promises to only read and to stay offline; lazy fetch broke both without any error. Found while writing the
README (2026-11-27).

### How to apply
- Any new git command that reads file contents: try it on fixtures `partial` / `partialBare`; if its failure
  wording differs, extend `partial.ts`.
- Fixture clones need `file://` and `uploadpack.allowFilter` on the source (set in the builder's GLOBAL_CONFIG),
  or `--filter` is dropped with only a warning ("filtering not recognized by server").
- The builder must not set `GIT_NO_LAZY_FETCH`: a blobless clone's checkout lazy-fetches HEAD's blobs. `fixtureGit`
  does set it, so test-side inspection never writes into the fixtures that parallel tests share.
- Tests that read contents from the partial fixtures skip on git < 2.44 (`NO_LAZY_FETCH_SUPPORTED`).

Related: [[git-diff-gotchas]], [[build-and-runtime-gotchas]], [[product-scope]]
