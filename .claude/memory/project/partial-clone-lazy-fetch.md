---
name: partial-clone-lazy-fetch
description: Partial clones make git download missing objects on demand (lazy fetch); gittree blocks it with GIT_NO_LAZY_FETCH, lists details without counts and answers 409 objects_missing for diffs
keywords: [partial clone, blobless, filter, lazy fetch, promisor, GIT_NO_LAZY_FETCH, objects_missing, contentsMissing, read-only, offline, mailmap, uploadpack, allowFilter, numstat]
source: fallback chosen by the user over failing details, relayed by the README session (2026-11-27)
updated: 2026-11-27
---

### Rule / Fact
- In a partial clone (`--filter=blob:none`) git downloads missing objects whenever a command needs them, writing a
  new promisor pack and starting `git maintenance --auto`. Verified triggers (git 2.50): `diff-tree --numstat`,
  `-M`, `-p` (one batched fetch), `cat-file --batch-check` (one fetch per blob), `diff-tree --cc`, and in a bare
  clone `log --format=%aN` reading `HEAD:.mailmap`, i.e. the graph route.
- The runner sets `GIT_NO_LAZY_FETCH=1` (git 2.44+; older git ignores it and still downloads). git then fails in
  two wordings: prefetching diffs say `fatal: could not fetch <oid> from promisor remote`; direct reads (`--cc`) say
  `fatal: unable to read <oid>`, which counts as missing only in a partial clone (`src/server/git/partial.ts`).
- Commit details then fall back to `diff-tree --raw --no-renames`: no counts, a rename is a deletion plus an
  addition, `compare.contentsMissing: true`, not cached. A file diff and the `--cc` view answer 409
  `objects_missing`, naming a git command that would download the contents.
- Not failures: `cat-file --batch-check` prints `<oid> missing`; `log` with an unreadable `HEAD:.mailmap` exits 0
  and skips the mailmap (bare partial clones show unmapped names).

### Why
gittree promises to only read and stay offline; lazy fetch broke both without any error. Failing the details
instead of falling back would lose the message body and committer for nearly every commit of a blobless clone,
since the parent's file versions are the ones missing.

### How to apply
- A new git command that reads file contents: try it on fixtures `partial` / `partialBare`; extend `partial.ts` if
  its failure wording differs. M7's `log --numstat` stats will fail this way too: plan a fallback.
- Fixture clones need `file://` and `uploadpack.allowFilter` on the source (the builder's GLOBAL_CONFIG), or
  `--filter` is dropped with only a warning ("filtering not recognized by server").
- The builder must not set `GIT_NO_LAZY_FETCH` (a blobless checkout lazy-fetches HEAD's blobs); `fixtureGit` sets
  it so test-side inspection never writes into fixtures that parallel tests share. A throwaway clone made with
  `fixtureGit` needs `--no-checkout`.
- Tests that read contents from the partial fixtures skip on git < 2.44 (`NO_LAZY_FETCH_SUPPORTED`).

Related: [[git-diff-gotchas]], [[build-and-runtime-gotchas]], [[product-scope]]
