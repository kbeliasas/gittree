---
name: git-diff-gotchas
description: Verified git output quirks behind gittree's commit/diff endpoints (--cc lists, diff-tree commit-id line, log on non-commits, pathspec globs, quoted patch paths)
keywords: [git, diff-tree, cc, combined, numstat, raw, conflict, merge, log, tree, tag, pathspec, glob, literal, quoted, unquote, commit-id]
updated: 2026-11-27
---

### Rule / Fact
- **`diff-tree --cc --numstat` is useless for conflict resolutions**: it lists every file changed vs the *first*
  parent, with first-parent counts. `--cc --raw` lists files differing from *every* parent, including cleanly
  3-way-merged ones that get **no** `--cc` hunk. gittree's `cc` file list = patch sections of
  `diff-tree -r -z --cc --raw -p`, matched to raw records (`src/server/commits/commit.ts` readCombined).
- With `-z`, the raw part ends with an extra NUL before the patch text; paths in patch headers are still
  C-quoted (`"tab\there.txt"`, octal bytes) → `unquotePath` in `src/server/git/diff.ts`.
- **`diff-tree` given one commit prints the commit id first** (e.g. `--root <sha>`, `--cc <sha>`): always pass
  `--no-commit-id`.
- **`git log -1 <id>`**: a tree id prints nothing with exit 0; an annotated tag id prints the commit it points
  at; a missing id exits 128 "bad object". The details route treats all three as 404 by comparing `%H`.
- **Pathspecs are globs and magic by default** (`a[1].txt`, `:(glob)…`): the runner sets
  `GIT_LITERAL_PATHSPECS=1` for every command. Revisit if M3's `path:` filter wants globs.
- Full-context trick: `-U<max blob size + 1>` makes one hunk holding the whole file (a file of n bytes has ≤ n+1
  lines); blob sizes come from one `cat-file --batch-check`.

### Why
Each was found by probing real repos while building M2; the wrong assumptions fail silently (wrong file lists,
shifted parsing, empty 200s) rather than with errors.

### How to apply
- Before changing the commit/diff readers or adding a git command with user paths, re-check the bullet that applies.
- Fixture `conflicts` covers the `--cc` cases; `files` covers renames, binaries, odd paths.

Related: [[build-and-runtime-gotchas]], [[product-scope]]
