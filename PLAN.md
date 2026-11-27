# GIT_TREE (`gittree`) — plan for a local, interactive git history explorer

Draft · 2026-11-26 · decisions below come from the planning Q&A

## 1. What it is

`gittree [path]` starts a small server on 127.0.0.1 and opens the browser. You explore any repository on your
machine: how branches forked and merged, what each commit changed, where something happened, which branches are
stale, who works where, and how a file evolved line by line. It never changes your branches, index or working
tree; the only write is an explicit **Fetch**.

Questions v1 answers:

- *How did this branch fork and merge?* → commit graph, hover highlighting, focus modes
- *What exactly changed here?* → commit details and diffs
- *Where and when did X happen?* → search and filters (text, author, date, path, content, Jira key)
- *Which branches can go?* → Branches view (stale, merged, upstream gone)
- *Who works on what, when, and where is the churn?* → Stats
- *Who wrote this line, and why?* → File history and blame

## 2. Decisions

| Topic | Decision | Why |
|---|---|---|
| Users & runtime | Personal local tool: CLI → server on 127.0.0.1 → browser | No hosting or login; a clean HTTP API keeps a hosted version possible later |
| Data source | Local repos through the `git` CLI | Full fidelity (all refs, merges, renames, `.mailmap`), fast, offline |
| Repo size | Under 10k commits | The whole graph loads in one request and is laid out in the browser; no indexing service |
| Main view | Vertical lanes + commit list; details and diff panel on the right | Best for reading history; row virtualization keeps it smooth |
| Git actions | Read-only + Fetch | Can't lose work; Fetch keeps `origin/*` current so stale-branch data is right |
| Stack | TypeScript: React (Vite) + Node (Fastify) | One language and shared types end to end; strongest ecosystem for graph, diff and chart UI |
| Opening repos | One running app with a repo switcher (recents + repos found under scan roots); `gittree <path>` opens one directly | Switch repos without restarting |
| Interactions | Hover highlights a branch line · click for details · filter & focus | Your picks |
| Stats | Contributors over time · activity heatmap + punch card · file hotspots · branch & merge habits | Your picks |
| Extras | Jira issue links · file history & blame | Your picks |

**Not in v1** (deselected; easy to add later): comparing branches (the Branches view only shows ahead/behind
counts), comparing two arbitrary commits, minimap, time-travel playback, live file-watching refresh, graph export,
hosting APIs / clone-by-URL / browser-only mode, any write action beyond fetch, multi-user hosting, optimizations
for repos over 10k commits.

## 3. Core flows

1. **Open.** `gittree ~/code/shop` → History opens with HEAD selected. If gittree is already running, the CLI hands
   the path to it and opens a tab instead of starting a second server.
2. **Read the topology.** Hover a commit → its branch line lights up and the rest dims. Click a merge →
   "Merged feature/login: 12 commits over 3 days", with those commits highlighted. *Topology only* collapses history
   to branch tips, tags, forks and merges; *First-parent* shows main as a sequence of merges.
3. **Inspect a commit.** Message, author and committer, parents and children, branches and tags that contain it,
   Jira links, changed files with +/−; click a file for its diff (split or unified).
4. **Find something.** `author:alice path:src/api login` dims non-matching commits (topology stays visible) or hides
   them (the graph is re-linked through the nearest matching ancestors). `content:"parseToken"` runs a pickaxe
   search with progress and cancel.
5. **Tidy branches.** The Branches view lists stale, merged and upstream-gone branches with ahead/behind vs main; a
   click focuses the branch in the graph; cleanup commands are offered for copying — the app never runs them.
6. **Get insights.** Stats view; every bar, cell and tile links to the filtered history behind it.
7. **Dig into a file.** History across renames plus blame; click a blame chunk to jump to its commit; *Blame before
   this change* walks further back.

## 4. Screens

History (home):

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [my-repo v]  main   Cmd+K   Search: author:alice path:src/api login   [Fetch]        │
│ Order: (Date|Topo)   [ ] First-parent   [ ] Topology only   Matches: (Dim|Hide)      │
│ Branches: all local + origin/*  [edit]                9,412 commits · fetched 3d ago │
├──────────┬─────────────────────────────────────────────────┬─────────────────────────┤
│ History  │ ●     Merge 'feature/login'   main     alice 2h │ a1b2c3d · alice · 2h    │
│ Branches │ ├─╮                                             │ Merge 'feature/login'   │
│ Files    │ │ ●   SHOP-12 Add login form  feature… alice 3h │ Parents 7a6b5c4 9f8e7d6 │
│ Stats    │ │ ●   Login API client                 alice 5h │ Merged  2 commits · 5h  │
│ Settings │ ● │   Fix typo in README               bob   6h │ In      main            │
│          │ ├─╯                                             │ Jira    SHOP-12 (link)  │
│          │ ●     Release 1.2.0           v1.2.0   bob   2d │ Files (3)       [Split] │
│          │ ●     Initial commit                   bob   5d │ M src/api/login.ts  +40 │
│          │                                                 │ A src/ui/Login.tsx  +88 │
│          │                                                 │ D old/auth.js       -52 │
└──────────┴─────────────────────────────────────────────────┴─────────────────────────┘
```

- Hover a row: its branch line stays bright, everything else dims. Alt+hover: all ancestors.
- Click a ref badge: focus that branch (its own commits highlighted, fork point marked).
- Click a file: the right panel widens into a full diff view; Esc returns.

Branches (`vs main` = commits ahead / behind):

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ Branches   Show: (Local|Remote|All)   [Stale] [Merged] [Gone]         stale after 90d │
├───────────────────────────┬─────────┬────────┬─────────────┬────────┬─────────────────┤
│ Branch                    │ Last    │ By     │ vs main     │ Merged │ Status          │
├───────────────────────────┼─────────┼────────┼─────────────┼────────┼─────────────────┤
│ feature/payments          │ 3h      │ alice  │ +3 / -0     │ no     │ active          │
│ origin/hotfix/typo        │ 34d     │ bob    │ +2 / -41    │ no     │ aging           │
│ feature/SHOP-7-export     │ 7mo     │ carol  │ +12 / -310  │ no     │ stale           │
│ feature/SHOP-3-search     │ 5mo     │ alice  │ +0 / -88    │ yes    │ merged, delete? │
│ bugfix/null-check         │ 2mo     │ bob    │ +1 / -52    │ no     │ upstream gone   │
└───────────────────────────┴─────────┴────────┴─────────────┴────────┴─────────────────┘
```

Files — history and blame:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Files  src/api/login.ts @ main  [Cmd+P]         (History|Blame)  [ ] ignore whitespace │
├──────────────────────────────┬─────────────────────────────────────────────────────────┤
│ History (renames followed)   │ Blame @ main · tinted by age                            │
│ ● 9f8e7d6  3h  alice         │ 9f8e7d6 alice  3h │ 12 │ export async function login(   │
│   Add login form             │                   │ 13 │   user: string, pass: string   │
│ ● 3c4d5e6  5h  alice         │ e4f5a67 bob    9d │ 14 │ ) {                            │
│   Login API client           │ 3c4d5e6 alice  5h │ 15 │   const res = await post(url)  │
│ ● e4f5a67  9d  bob           │                   │ 16 │   return parse(res)            │
│   renamed from auth.ts       │ e4f5a67 bob    9d │ 17 │ }                              │
└──────────────────────────────┴─────────────────────────────────────────────────────────┘
```

Stats:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Stats   Branch: main v   Range: last 12 months v   Excludes: 6                  │
├────────────────────────────────────────┬────────────────────────────────────────┤
│ Contributors over time                 │ Activity                               │
│ stacked area: top 8 authors + others   │ calendar heatmap, one cell per day     │
│ commits | lines added/deleted          │ punch card: weekday x hour             │
├────────────────────────────────────────┼────────────────────────────────────────┤
│ File hotspots                          │ Branch & merge habits                  │
│ treemap by folder + sortable table     │ merges per week, merge vs direct       │
│ commits touched, churn (+/-)           │ branch lifetime: median and spread     │
└────────────────────────────────────────┴────────────────────────────────────────┘
```

## 5. Architecture

```
Browser · React SPA  (History · Branches · Files · Stats · Settings)
  │  URL holds all view state · TanStack Query cache · Web Worker: layout, filters, reachability
  │
  │  HTTP/JSON (+ SSE for fetch progress) · 127.0.0.1 only · session-token cookie
  ▼
Node server · Fastify
  │  auth + Host/Origin check → routes → repo registry → git runner → parsers → caches
  │
  │  spawn `git` (allowlisted read commands + fetch) · no shell · GIT_OPTIONAL_LOCKS=0
  ▼
git CLI → .git on disk        ~/.config/gittree (settings, recents)   ~/.cache/gittree (numstat cache)
```

- **git CLI, not a JS git library.** It is the fastest and most complete option (commit-graph files, packfiles,
  rename detection, blame, `.mailmap`, worktrees, SHA-256 repos) and it is already on every machine that has repos.
  JS libraries (isomorphic-git, nodegit) are slower, need native builds, or lack blame and rename detection.
- **Read-only guard.** The runner only accepts allowlisted subcommands (`log`, `show`, `diff`, `diff-tree`,
  `rev-parse`, `rev-list`, `for-each-ref`, `ls-tree`, `cat-file`, `blame`, `cherry`, `symbolic-ref`,
  `config --get`, plus `fetch`). Arguments are arrays, never a shell string; user input (refs, paths, patterns)
  goes after `--end-of-options` or `--`. Environment: `GIT_OPTIONAL_LOCKS=0` (never takes `index.lock` while your
  IDE works), `GIT_TERMINAL_PROMPT=0`, `GIT_LITERAL_PATHSPECS=1` (file names with `*`, `[` or a leading `:` stay
  literal), `GIT_NO_LAZY_FETCH=1` (in a partial clone git never downloads missing objects; what needs them says
  they aren't stored locally; git 2.44+, older git ignores it), `LC_ALL=C`, `core.quotepath=off`. Diffs run with
  `--no-ext-diff --no-textconv`.
- **Localhost safety.** Bind 127.0.0.1 on a random free port. The CLI opens a URL with a one-time token that the
  server swaps for an HttpOnly, SameSite=Strict cookie; every request needs it, the Host header must be
  `127.0.0.1:<port>` or `localhost:<port>` (blocks DNS rebinding), and there is no CORS. Without this, any web page
  you visit could read your source code through the API. Cookies aren't port-scoped, so the cookie name includes the
  port; and since another port on 127.0.0.1 counts as *same-site*, `Origin` and `Sec-Fetch-Site` are checked too:
  other local pages can't call the API even while you're signed in.
- **Caching.** Commits are immutable, so details, diffs, blame and per-commit numstat are cached by SHA (in-memory
  LRU; numstat also on disk). Graph, branch and stats results are keyed by a *refs snapshot* — a hash of
  `for-each-ref` output + HEAD — and recomputed only when refs move.
- **Refresh.** A Refresh button, plus a cheap check when the tab regains focus: if the refs snapshot changed, a
  "History changed — reload" banner appears. No file watching (live refresh was deselected).
- **Compact graph payload.** Parents as row indices, authors de-duplicated, numeric timestamps: ~10k commits is
  about 1.5 MB of JSON, a few hundred KB gzipped.

## 6. Git commands and API

| Need | Command (simplified) |
|---|---|
| Graph | `git log --branches --remotes --tags HEAD --date-order --format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%ct%x00%s%x1e` |
| Refs + upstream state | `git for-each-ref --format=%(refname)%00%(objectname)%00%(*objectname)%00%(upstream)%00%(upstream:track) refs/heads refs/remotes refs/tags` |
| HEAD, default branch | `git symbolic-ref -q HEAD` · `git rev-parse HEAD` · `git symbolic-ref refs/remotes/origin/HEAD` |
| Full messages (search) | `git log --format=%H%x00%B%x1e <same revs>`, loaded in the background |
| Commit details | `git log -1 --date=raw --format=%H%x00%P%x00%aN…%cd%x00%B <sha>` |
| Changed files | `git diff-tree -r -z -M --raw --numstat <parent> <sha>` (`--root <sha>` for root commits) · sizes from `git cat-file --batch-check` · a partial clone without the contents: `--raw --no-renames` (no counts, no renames) |
| One file's diff | `git diff-tree -p -U<n> [-w] [-M] <parent> <sha> -- [<old path>] <path>` — whole file as context up to 1 MiB, else `-U3` |
| Conflict resolutions | `git diff-tree -r -z --cc --raw -p <merge>` — files without a `--cc` hunk (clean 3-way merges) are left out |
| Path / content search | `git log --format=%H <revs> -- <path>` · `git log -S<text>` / `-G<regex>` |
| Files at a commit | `git ls-tree -r -z --name-only <sha>` |
| File history | `git log --follow --name-status --format=… <sha> -- <path>` |
| Blame | `git blame --porcelain [-w] [-M -C] [--ignore-revs-file .git-blame-ignore-revs] <sha> -- <path>` |
| Rebased-merge hint | `git cherry <default-branch> <branch>` |
| Stats input | `git log --no-merges --numstat -M --format=… <ref>`, results cached per commit |
| Fetch | `git fetch --all --prune --progress` · last fetch time = mtime of `FETCH_HEAD` |

Ahead/behind counts, "merged?", "contained in", children and merged-commit lists are computed in the browser's
worker from the commit graph — no extra git calls.

Endpoints (`:id` is a short hash of the repo's absolute path; the client never sends raw paths except when adding
a repo):

| Endpoint | Returns |
|---|---|
| `GET /api/repos` · `POST /api/repos {path}` | Recents + scanned repos · validate (`rev-parse --show-toplevel`) and add |
| `GET /api/repos/:id/graph?order=date\|topo&limit&cursor` | Snapshot id, HEAD, default branch, refs, commits — one page (default 10,000 commits); `page.next` continues it |
| `GET /api/repos/:id/snapshot` | Current refs snapshot (focus check) |
| `GET /api/repos/:id/messages` | Full messages for search |
| `GET /api/repos/:id` | HEAD, shallow, commit count, web link for commits (from `origin`'s URL, no API calls) |
| `GET /api/repos/:id/commits/:sha?parent=1\|2…\|cc` | Full message, author and committer (with time zones), parents, changed files with status, +/−, renames, modes and sizes |
| `GET /api/repos/:id/diff?sha&parent&path&ws` | Parsed hunks for one file (`path` must be in the commit's file list) |
| `GET /api/repos/:id/search?path=\|content=\|regex=` | Matching SHAs (streamed; cancelled when the client disconnects) |
| `GET /api/repos/:id/tree?at` · `file-history?path&at` · `blame?path&at&ws&moves` | File list · commits + rename points · line ranges → commit |
| `GET /api/repos/:id/stats?ref&since&until` | The four stats datasets |
| `POST /api/repos/:id/fetch` | SSE progress, then the result |
| `GET` / `PUT /api/settings` | Scan roots, Jira, thresholds, excluded paths (M2: `GET` only, Jira only) |

Graph payload:

```ts
interface GraphPayload {                    // src/shared/api.ts is the source of truth
  snapshot: string;                         // hash of refs + HEAD (+ shallow boundary)
  order: 'date' | 'topo';
  head: { sha: string | null; branch: string | null };  // null sha = no commits; null branch = detached
  defaultBranch: string | null;             // origin/HEAD → main → master → develop → HEAD's branch → any
  authors: { name: string; email: string }[];  // per page
  commits: {
    sha: string;
    parents: (number | string)[];           // index into the graph's commits, or the hash of a parent on a later page
    boundary?: true;                        // shallow clone: parents aren't in the repository
    author: number;                         // index into authors[]
    authorTime: number;                     // unix seconds
    commitTime: number;
    subject: string;
  }[];
  refs: {                                   // refs pointing at commits on this page
    name: string;                           // "main", "origin/main", "v1.2.0"
    kind: 'local' | 'remote' | 'tag';
    commit: number;                         // index into the graph's commits
    upstream?: string;
    upstreamGone?: true;
  }[];
  page: { offset: number; total: number; next: string | null };
}
```

The walk starts from the snapshot's own commit ids (`git log --stdin`), so a page always matches its snapshot; a
cursor from an older snapshot gets `409 snapshot_changed`.

## 7. Graph layout and interaction

- **Order:** date order by default (what happened when); topo order as a toggle (keeps each branch's commits
  together, fewer crossings).
- **Lane assignment** (a pure function in a Web Worker, unit-tested):
  1. Walk commits newest → oldest, keeping `lanes[]` = the commit each lane is waiting for.
  2. A commit takes the leftmost lane waiting for it, or the first free lane if none is (a branch tip). Other
     lanes waiting for the same commit end there (fork edges).
  3. Its first parent continues in the same lane; each extra parent (merge) joins the lane already waiting for it
     or opens a new one.
  4. Lane 0 is reserved for the default branch's first-parent chain, so main is always a straight line on the left.

  Output: a column per commit and edge segments per row. 10k commits lay out in well under 100 ms.
- **Colors** follow branch identity (the ref whose first-parent chain owns the commit; default branch first, then
  local, remote, tags), stable via a hash of the name, tuned for light and dark themes, and never the only cue
  (badges and hover carry the same information).
- **Rendering:** virtualized rows (~28 px); the graph column draws only the visible slice as SVG, which keeps
  hit-testing and theming simple. Lanes are straight; forks and merges run sideways and turn into their lane with
  a rounded corner.
- **Keyboard:** ↑/↓ or j/k move (PageUp/PageDown, Home/End jump), `[` / `]` parent / child along the line, Enter
  opens the first file's diff, `/` search, Cmd+K palette, Cmd+P file finder, Esc clears focus. Clicks and
  parent/child jumps add a Back entry; stepping with the keys replaces it. With a diff open: j/k next / previous
  file, `[` / `]` still move between commits (same file when that commit changed it, else its first file), the
  arrow keys scroll the diff unless the commit list has the focus, Esc closes the diff.
- **Where it runs:** lane layout and branch lines in the worker; hover, Alt+hover and focus reachability on the main
  thread (well under a millisecond for 10k commits, and it has to keep up with the pointer).
- **The URL holds the state** (repo, view, selection, filters): links are bookmarkable and browser Back/Forward
  retrace your exploration.
- **Filter & focus:**
  - *Branch visibility* — pick refs (presets: local only · local + origin · hide tags); visible commits are those
    reachable from the picks; layout reruns in the worker.
  - *First-parent* — follow first parents from the chosen branch: main as a sequence of merges.
  - *Topology only* — keep branch tips, tags, merges, fork points and roots; rewrite parents to the nearest kept
    ancestor (like `--simplify-by-decoration`).
  - *Matches: dim or hide* — dim keeps the full graph; hide re-links each match to its nearest matching ancestor
    so lanes stay connected.
  - *Focus a branch* (click its badge) — highlight commits reachable from it but not from the default branch; mark
    the fork point and the merge.

## 8. Feature details

### Commit details & diffs

- Full message; author and committer shown separately when they differ (rebases, cherry-picks); absolute and
  relative dates; parents and children as links; branches and tags that contain the commit.
- Merge commits: diff against the first parent by default ("what this merge brought in"), switchable per parent or
  to the merge's **conflict resolutions** (`--cc`: only hunks that differ from every parent); merged commits
  (`M^1..M^2`, every extra parent for octopus merges) with how long that branch lived. Selecting a merge marks its
  merged commits at the row's edge without dimming anything; hovering "Merged …" in the panel dims the rest.
- Files: status (added, modified, deleted, renamed with similarity), +/−, grouped by folder; binary files say so
  (with sizes); diffs with more than 2,000 changed lines wait for "Load diff".
- Diff viewer (gittree's own, not a library): split or unified (remembered; split from 1280 px), Shiki
  highlighting in a worker with the JavaScript regex engine (no WebAssembly, so the CSP stays strict), word-level
  changes within paired lines, ignore-whitespace toggle (in the URL), virtualized rows with wrapped lines. Files up
  to 1 MiB arrive with the whole file as context: unchanged runs fold around each change and unfold 20 lines at a
  time or all at once without another request, and highlighting sees the whole file. Larger files get `-U3`.
- The URL holds the open diff: `file`, `parent` (`2`…, `cc`) and `ws`; Back/Forward retrace diffs too.
- "GitHub ↗" (GitLab, Bitbucket incl. Server, Azure DevOps, Codeberg/Gitea, SourceHut) links the commit to its page,
  built from `origin`'s URL (or `upstream`, or the first remote); local remotes and unknown hosts get no link.

### Search & filter

- One bar with chips. Free text matches subject, body, SHA prefix and ref names. Tokens: `author:` `after:`
  `before:` `ref:release/*` `jira:SHOP-12` `merges:only|none` `path:` `content:"…"` `regex:/…/`.
- Instant, in the worker: text, author, dates, refs, Jira, merges. On the server (async, cancellable, cached):
  `path:`, `content:`, `regex:`.
- Match count, with n / N to step through matches.

### Branches & staleness

- Columns: branch, local or remote (a local branch and its `origin/` twin at the same commit share one row), last
  commit date and author, ahead/behind vs the default branch, merged?, upstream state (tracking · ahead/behind ·
  gone · none), fork point and age.
- Default rules (configurable): active < 30 days · aging 30–90 · stale > 90 days without commits · merged = tip
  reachable from the default branch · gone = upstream deleted on the remote.
- "Maybe merged" hint for rebased branches via `git cherry`; squash-merged branches can't be detected reliably and
  stay marked unmerged, with a note.
- Read-only actions: focus in graph, copy name, copy cleanup commands (`git branch -d …`,
  `git push origin --delete …`).

### File history & blame

- Pick a file with the fuzzy finder (tree at the selected commit), from a commit's file list, or from a hotspot.
- History follows renames and marks rename points; the same commits are highlighted in the main graph.
- Blame gutter per chunk (short SHA, author, age), tinted by age; click → select the commit; *Blame before this
  change* re-blames at `<sha>^`; toggles for ignore whitespace (`-w`) and moved/copied lines (`-M -C`); honors
  `.git-blame-ignore-revs` when present.
- Virtualized lines with Shiki highlighting (grammars lazy-loaded).

### Stats

Scope controls: branch (the default branch, or all refs), date range, excluded paths (lockfiles, `dist/`, `build/`,
`vendor/`, `*.min.*`, `*.map`).

- **Contributors over time** — commits or lines added/deleted per author per week or month; stacked area of the
  top 8 plus "others"; identities merged through `.mailmap`.
- **Activity** — calendar heatmap (one cell per day, last 12 months or a chosen year) and a weekday × hour punch
  card in each author's own timezone (taken from the commit's offset).
- **File hotspots** — commits touching and churn (+/−) per file and folder; treemap by folder plus a sortable
  table; renames folded into the current path.
- **Branch & merge habits** (default branch, first-parent) — merges per week; share of merge vs direct commits;
  branch lifetime = merge time − oldest merged commit (median and spread); squash merges *estimated* from message
  patterns (GitHub `(#123)`, Bitbucket `Merged in … (pull request #N)`).
- Every chart element links to History with the matching filter (author + week, day, file, merged branch).
- Computed on the server from per-commit numstat cached on disk; the first run on 10k commits takes a few seconds
  (progress shown), later runs only aggregate.

### Jira links

- Settings: Jira base URL and project keys (e.g. `SHOP, OPS`). Keys in subjects, bodies and branch names
  (`feature/SHOP-123-login`) link to `<base>/browse/SHOP-123`.
- `jira:SHOP-123` highlights every commit and branch for a ticket; a ticket facet lists keys with commit counts.
- Known project keys avoid false positives like `UTF-8`, `SHA-256`, `ISO-8601`; with none configured, a generic
  pattern with a deny-list is used.
- No Jira API calls in v1 (no tokens needed); issue titles and status could come later.
- Until the Settings view (M4), `jira.baseUrl` and `jira.projectKeys` are edited by hand in
  `~/.config/gittree/config.json` (`$XDG_CONFIG_HOME/gittree` when set), read on every request; invalid values are
  skipped and reported. Keys are detected without it, and link once a base URL is set.

### Repos, settings, fetch

- `~/.config/gittree/config.json`: scan roots, recents (last 20), Jira, staleness thresholds, excluded paths,
  per-repo overrides (default branch, Jira keys). Settings never live inside your repos.
- Scan: async walk of the scan roots (depth 4), skipping `node_modules`, `vendor`, `.venv` and build folders; finds
  `.git` directories and worktree `.git` files; cached and rescannable.
- Cmd+K palette: repos, branches, tags, commits by SHA, files.
- CLI: `gittree [path] [--port N] [--no-open]`. A second invocation reuses the running instance (port and token in
  `~/.config/gittree/server.json`, mode 600).
- Fetch: `git fetch --all --prune --progress`, progress streamed, 60 s timeout, then the graph reloads. It never
  prompts — terminal prompts are off and SSH runs in batch mode (unless you configured your own SSH command) — so
  auth problems show as a clear message instead of a hang. `--prune` is what makes "upstream gone" accurate.

## 9. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 22.18 or newer, TypeScript 7 (strict) | Current LTS line; dev runs the `.ts` sources directly (type stripping) |
| Package manager | pnpm | Your pick |
| Server | Fastify + zod | Fast, `inject()` for route tests, schemas shared with the client |
| Git | System `git` ≥ 2.30 via `child_process.spawn` | Version checked at startup with a clear error |
| Frontend | React + Vite | Fast dev loop; a static build the server can serve |
| Routing & state | TanStack Router (typed URL search params), TanStack Query, Zustand for hover/selection | The URL is the source of truth for views |
| Lists | TanStack Virtual | Smooth 10k-row lists |
| Off the main thread | Web Worker + Comlink | Layout, filtering, reachability |
| UI | Tailwind CSS, Radix primitives, cmdk | Accessible menus and popovers; command palette |
| Diffs & code | Own renderer on TanStack Virtual + Shiki (JavaScript regex engine, in a worker) | Chosen at M2 over `@git-diff-view/react` (0.1.x, own CSS, Shiki 3 adapter, no clear virtualization) and `react-diff-view` (no virtualization): full-context diffs give exact highlighting and free context expansion |
| Charts | Apache ECharts | Calendar heatmap, punch card, treemap and stacked area in one library, canvas-fast |
| Tests | Vitest, Playwright | One runner for server and web; real-browser E2E |
| Packaging | Vite (web) + tsdown (server) → `dist/`; `pnpm link --global` gives a global `gittree` | tsdown replaces the original pick, tsup, which is no longer maintained |

## 10. Project structure

```
GIT_TREE/
├── package.json            # bin: gittree → dist/server/cli.js
├── scripts/                # pnpm dev: Vite + the API server in watch mode
├── src/
│   ├── shared/             # zod schemas + API types used by both sides
│   ├── server/
│   │   ├── cli.ts          # args, single-instance handoff, open browser
│   │   ├── app.ts          # Fastify, token cookie, Host/Origin checks, serves the SPA
│   │   ├── git/            # runner (allowlist, env, timeouts, abort) + parsers
│   │   ├── repos/          # registry: ids, recents, scan roots
│   │   ├── routes/         # graph, commits, diff, search, tree, blame, branches, stats, fetch
│   │   └── stats/          # numstat cache + aggregations
│   └── web/
│       ├── graph/          # lane layout, focus/filter transforms, worker, SVG renderer, colors
│       ├── features/       # history, details, diff, branches, files, stats, settings
│       └── lib/            # API client, query-syntax parser, shortcuts, Jira matcher
├── test/
│   ├── fixtures/           # script that builds deterministic test repos
│   └── e2e/                # Playwright specs
└── PLAN.md
```

One package, no workspace tooling: shared types are a folder, not a package. `pnpm dev [path]` runs Vite (with `/api`
and `/auth` proxied) and the server in watch mode; `pnpm build && pnpm link --global` installs the `gittree` command;
`pnpm fixtures` builds the test repositories into `test/fixtures/.repos` for manual exploration.

## 11. Testing

- **Fixture repos** built by a script with fixed authors and dates: linear history; feature branches with merges;
  criss-cross and octopus merges; multiple roots; renames and moves; binary files; Unicode and spaces in paths;
  annotated and lightweight tags; detached HEAD; empty repo; shallow clone; worktree; submodule; old branches for
  staleness; an upstream-gone branch (via a local bare remote); `.mailmap` duplicates; Jira-like keys including a
  `UTF-8` false positive; a merge with a resolved conflict, an edit only the merge made and a clean 3-way merge,
  plus a whitespace-only commit and a GitHub-style `origin` URL (`conflicts`); blobless partial clones of `conflicts`
  and (bare) of `people`. The fixture root also holds a gittree config (Jira base URL and keys) that E2E runs and
  previews use instead of yours.
- **Unit:** parsers; lane-layout invariants (one commit per cell, edges only between adjacent rows, main stays in
  lane 0) plus a snapshot per fixture; parent rewriting for focus modes; query parser; Jira matcher; stats
  aggregations.
- **Server:** every route against fixtures via Fastify `inject`, plus a **read-only test** that calls every
  endpoint except fetch and asserts every file of every fixture (refs, index, working tree, object store) is
  byte-identical afterwards, partial clones included.
- **E2E:** open fixture → hover/click → diff; search dim/hide; branch row → focus; blame → commit; stats
  click-through.
- **Performance budget** (a ~10k-commit public repo): graph interactive < 1.5 s after open · 60 fps scrolling ·
  commit details < 150 ms · diff < 300 ms · stats < 10 s cold, < 300 ms warm.

## 12. Milestones

| # | Milestone | Delivers | Size |
|---|---|---|---|
| M0 | Skeleton — **done** | CLI → server → browser with token; git runner + allowlist; fixture builder; test setup | S |
| M1 | Graph — **done** | Paged graph endpoint (newest 10k + "N older not shown" notice), lane-layout worker, virtualized list, ref badges, hover, selection, keyboard, URL state, branch focus (badge click), commit summary panel from graph data | L |
| M2 | Details & diffs — **done** | Details panel (full message, author/committer, merged commits marked in the graph, contained-in, Jira links from the config file, link to the hosting service), file list per parent or conflict resolutions (`--cc`), diff viewer (split/unified, Shiki, word diff, folding, ignore whitespace, large-diff gate), diff keys | M |
| M3 | Search & focus | Filter bar + syntax, path/content search, dim/hide, branch visibility, first-parent, topology only | L |
| M4 | Repos & fetch | Settings file, recents + scan roots, Cmd+K, single instance, fetch with progress, refresh banner | M |
| M5 | Branches | Branches table, staleness rules, ahead/behind, merged/gone, cleanup commands, focus link | M |
| M6 | File history & blame | File finder, history across renames, blame with age tint, blame-before-change | M |
| M7 | Stats | Numstat cache, four stats views, click-through to history | L |
| M8 | Polish | Dark-mode pass, empty/error states (empty repo, shallow, git missing), performance budget, README | S |

First usable version after **M2**: browse the topology, inspect commits and diffs. M3–M7 can be reordered (for
example, stats before search).

## 13. Risks

| Risk | Mitigation |
|---|---|
| Lanes get messy on tangled histories (criss-cross merges, many long-lived branches) | Main pinned to lane 0, topo-order toggle, topology-only view, fixture snapshot tests |
| The local server exposes your code to other web pages (DNS rebinding, CSRF) | 127.0.0.1 only, random port, token cookie, Host/Origin checks, no CORS |
| Fetch hangs on a credential prompt | Prompts disabled, SSH batch mode, 60 s timeout, clear error |
| Interfering with your IDE's git use | Read commands only, `GIT_OPTIONAL_LOCKS=0`, retry transient lock errors |
| git downloads what a partial clone lacks whenever a diff (or a bare repo's `.mailmap`) needs it: network access and new packs | `GIT_NO_LAZY_FETCH=1` (git 2.44+); commit details then list files without counts or renames, and diffs that need missing contents answer 409 `objects_missing`; the read-only test covers two partial clones. M7's `log --numstat` stats will meet the same |
| Squash and rebase merges are invisible to "merged?" and habit stats | `git cherry` hint for rebases; squash merges estimated from messages and labeled as estimates |
| Jira false positives (`UTF-8`, `SHA-256`) | Configured project keys; deny-list fallback |
| One person with several emails skews stats | `.mailmap` (`%aN` / `%aE`); an alias editor later |
| A repo outgrows 10k commits | The graph endpoint accepts `limit`/`cursor` from day one; above the cap the UI loads the newest 10k and says how many older commits aren't shown ("load more" later); a real large-repo mode is a later project |
| Unusual repos (empty, shallow, detached HEAD, SHA-256, worktrees, submodules) | Each has a fixture and a defined UI state |

## 14. Defaults I picked (easy to change)

- Name and command: `gittree`
- Port: random free port (`--port` to pin one)
- Default branch: `origin/HEAD` → `main` → `master` → `develop`, overridable per repo
- Graph order: date order
- Staleness: active < 30 days, aging 30–90, stale > 90
- Excluded from stats: lockfiles, `dist/`, `build/`, `vendor/`, `*.min.*`, `*.map`
- Diffs: split on wide screens, unified on narrow ones
- Theme: follows the system light/dark setting

## 15. Later

Compare branches and arbitrary commits · minimap · time-travel playback · live refresh · export (SVG/PNG/HTML) ·
Jira titles and status via the API · pull-request info from GitHub/GitLab/Bitbucket · large-repo mode · light
write actions (checkout, branch, tag).
