# Proposal: architecture map comment on pull requests

- **Date:** 2026-11-08
- **Status:** Implemented 2026-11-08 (phases 0b, 1–4; experimental). Pending, by the person: phase 0a (light theme, a real PR comment, `large.md` render) and phase 0c (the map-skipped limit from real PRs). The CI step has never run on GitHub.
- **Scope:** `@agentreins/core` (structural diff and comment rendering, pure), `@agentreins/cli` (`reins review --map`, base graph), the CI workflow template, docs.
- **Reference output:** [`pr-map-examples/`](pr-map-examples/): `short.md`, `small.md`, `large.md`. They are the exact comments the renderer must produce for their (invented) inputs, and the snapshot tests' targets. They were generated from data by a throwaway script that applies the rules below, so they agree with each other byte for byte. When this text and an example disagree, the example wins.

## 1. Problem

A text diff hides changes to the shape of the app. A new import between two domains is one line among hundreds, and it creates coupling for years. A new folder that no path in `architecture.yml` covers passes `check` because no rule looks at it. Today a reviewer only learns this by reading every file.

Goal: on every PR, CI posts one comment that shows how the PR changes the structure (domains, dependencies between them, violations, reach), so the reviewer knows where to look before opening a file.

Non-goals: judging logic, naming or tests. The comment says where to look, not whether the code is right.

## 2. Principles

1. **Deterministic.** Templates filled with data. No LLM, no API besides posting the comment. Same PR, same text.
2. **One comment per PR, edited in place** on every push.
3. **Always comment, always with the map** (except when skipped, 3.1). No structural change: the short form, whose map only has touched and affected boxes, so it stays small; colors and the summary line carry the signal.
4. **Words first, picture second.** The `diff` block with verbs ("now uses") is the main view: tested readers read the bare arrows backwards. The map supports it.
5. **New is not good.** New things are violet ("review this"), never green on the map. Red only for what breaks a rule. Orange for mutual dependencies.
6. **Reuse what exists:** adapter graph, `impactOf`, `runCheck`, `pickBaseRef`, `parseConfig`, `showFile`. No new dependency.
7. **Never fail the job because of the comment.** `check` stays the gate.

## 3. The comment

Exact output: see the three examples. This section gives the rules behind them.

### 3.1 Forms

There is **one map rule** for every PR: draw only what changed. Nodes: those on a new, removed, mutual or forbidden edge, new domains, no-domain folders, and affected nodes when there are at most 4 (more: only counted in the context line and Details). Edges: the structural ones, plus one thin grey edge per drawn affected node to the touched node it imports (the only unchanged edge ever drawn). Touched domains with no structural change are not drawn; when there are any, a `<sub>` note says how many and points to Files by domain. A small PR and a large refactor go through the same code; the large one just has more boxes.

Two variations remain, and neither is a different map:

| Variation | When | Example |
| --- | --- | --- |
| **short** | No structural change (4.5) | `short.md`: "No structural changes", one context line, the map open (touched and affected boxes, affected → touched edges), Files by domain folded. More than 8 touched domains: draw the 8 with most changed files and say `+ N more touched` in the context line; the cap is strict (no ninth box to hold an affected edge). |
| **no code changes** | A short form whose changed files include no analyzed code file (docs-only PR, or base = HEAD) | Summary `**No code changes**`, no map and no legend; the context line counts the files not analyzed and outside layers. |
| **map skipped** | Structural edges > 20 (assumption, calibrated in phase 0c; a constant at the top of the renderer), or the comment would exceed GitHub's size limit (3.8) | No Mermaid block and no legend; a `<sub>` note: `Map skipped: N structural changes. Consider splitting this PR.` The diff block and Details carry everything. |

`small.md` and `large.md` both follow this rule; they differ only in size.

### 3.2 Order of the blocks

1. Marker `<!-- reins:pr-map -->` (first line; CI finds the comment by it).
2. `### Architecture changes`.
3. Summary line, bold counts, only the non-zero ones, in this order: new domains, new dependencies, removed, mutual, folders outside architecture.yml, removed domains, violations.
4. `<sub>` context line: `Compared with <base> at <sha>` · `N files` (every changed file, as GitHub counts them). `touched:` and `affected:` (names, or `N domains` when more than 4) only when there is **no map** (skipped, or no code): with a map they are its boxes, and naming them again is noise. With a map, extra `<sub>` lines say only what the map leaves out: `N touched domains have no structural change and are not on the map: see Files by domain.` (short form: `N more touched domains are not on the map: see Files by domain.`) and `N affected domains are not on the map (M files import changed code): see Details.` (short form: names instead of Details).
   When some changed files are not on the map (not code reins reads, or outside every layer), the count gets one short note, never a list: `34 files (21 not on the map: they don't change the architecture)`.
5. `> [!CAUTION]` with one line per **new** violation: `**<rule>:** <check message> <check fix>`. Omitted if none.
6. `> [!WARNING]` with one line per new mutual pair: both domains, one example import each way, `Neither can change without the other. No rule blocks it; decide if it is intended.` Omitted if none.
7. Mermaid map (3.3), then the two-line legend (3.4).
8. `diff` block (3.5).
9. `<details>` **Details** (3.6) and `<details>` **Files by domain** (3.7), closed.
10. `<sub>Generated by reins on every push · \`check\` result is in the reins job</sub>`.

### 3.3 Map

- `flowchart LR`, **no subgraphs**: layer subgraphs made Mermaid stack nodes in tall, crossing columns (tested, rejected). A map with no edges uses `flowchart TB`: with `LR`, Mermaid stacked the loose boxes in one tall column (seen on the first real PR, 2026-11-09).
- The `%%{init}%%` line exactly as in the examples (theme `base`, `curve: basis`, spacing, fonts, colors).
- Node order: new domains, touched, affected, no-domain, unchanged; alphabetical inside each group. Ids are `n1`, `n2`, … in that order; names only go in labels. Domain names like `end`, `default`, `class`, or names with `-`, `/`, `(`, `[` would break Mermaid as ids.
- Labels are Markdown strings: `` ("`**name**\nsecond line`") ``. Second line: `N files changed`, `new domain · N files`, `affected · N files`, `not in architecture.yml`, or nothing. Escape backticks and `"` in names; route folders like `app/(auth)/[id]` must render.
- Classes (exact values in the examples): `default` white, `touched` light yellow, `added` violet, `affected` blue, `nodomain` white with a dark dashed border.
- Edges are emitted by group, alphabetical by (from, to) inside each, so `linkStyle` indexes are computed, never hand-counted. `classDef default` always, then only the classes used, in the order touched, added, affected, nodomain; one `linkStyle` line per non-empty group. Groups: new allowed (violet), mutual (orange; both directions), removed (`-.->`, grey dashed), forbidden (`-. "#nbsp;#nbsp;breaks <rule>#nbsp;#nbsp;" .->`, red), affected → touched (thin light grey).

### 3.4 Legend

Two `<sub>` lines, only the entries that appear on this map:
- `**Boxes:**` 🟨 Touched · 🟦 Affected · 🟪 New · ⬜ Unchanged · ⬚ Not in architecture.yml
- `**Lines:**` the arrow points to the code being used (`<a real edge of this map>`: `<a> uses <b>`) · 🟪 New · 🟧 Mutual · 🟥 Breaks a rule · ┈┈ Removed · ── Unchanged

The example in the Lines entry uses the first edge of the map in this preference: forbidden, new, mutual, affected, removed.

### 3.5 The `diff` block

GitHub colors a `diff` block by the first character: `-` red, `!` orange, `+` green, space none. So the prefix encodes severity, not git semantics:

| Prefix | Kind | Text |
| --- | --- | --- |
| `-` | forbidden (a new edge, or a new violation on a node pair that already had an edge) | `<a>  now uses  <b>[ internals]  ✖ breaks <rule>` (` internals` for domain-boundary) |
| `!` | mutual | `<a>  now uses  <b>  ⇄ mutual: <b> also uses <a>` (both directions, two lines) |
| `+` | new allowed | `<a>  now uses  <b>` plus `(<a> is not in architecture.yml)` for no-domain sources |
| ` ` | removed | `<a>  no longer uses  <b>` |

Order: forbidden, mutual, new, removed; alphabetical by (from, to) inside each. Line = `<prefix> <from>  <verb>  <to>  <note>`, each column padded to its longest value, trailing spaces trimmed. More than 40 lines: keep the first 40 and add `… N more in Details`.

### 3.6 Details

One row per change, the cause named by file, in this order (alphabetical inside each): New domain, Removed domain, Not in architecture.yml, New dependency (`` `a → b`: `file` imports `file` ``, `(+N more)` when several files), Mutual (one row per pair, both imports), Removed dependency (`` `a → b`: last import removed from `file` ``), Affected (one row: `` `name` (N) `` per domain, by count). Omitted in the short form. Violations are not repeated here (the CAUTION box has them). Over 150 rows: group the rest per kind with `… one row per <kind> (N)`. The diff block (3.5) ends with `… N more in Details` only while Details lists every change; past 150 rows it says `… N more not listed: the PR is too large to list them`.

### 3.7 Files by domain

Domain, first 3 file names then `…`, count; sorted by count, descending. New domains marked `· new`; no-domain folders as `no domain`. When more than 10 rows, touched domains without structural change collapse into one row (`N more domains | no structural change | <count>`).

### 3.8 Size

GitHub rejects comments over 65,536 characters. The renderer limits itself to 60,000 characters: first it drops the map and says so, then it caps the diff, Details and Files by domain harder, and last it cuts at a line boundary, closing any open code fence and `<details>`, with a note. Test with a synthetic PR of 300 domains and a single giant line.

## 4. Definitions (the data model)

### 4.1 Node of a file

With the **head** `architecture.yml` for both base and head (the diff shows code changes, not config changes):

1. The file's domain, if a domain path matches (first match wins, as `domainOf` in `impact/index.js`).
2. Else the file's layer, if that layer has **no** domains inside it: the node is the layer.
3. Else, if the file is inside a layer that **has** domains (and no domain matches it), **no domain**: grouped by folder (the parent folder of the file, at most two levels under the layer root; tests fix the rule).
4. Else (outside every layer and every domain) it is **not a node** and not a structural change: a repo may leave code outside its layers on purpose (this one does with its tests). It is counted in the context line (`N files outside layers`), next to the files not analyzed.

Deleted files and the old path of a rename are placed with the **base** `architecture.yml` (when it exists), so the files of a removed domain count as that domain's, not as "not in architecture.yml". Ignored files (`ignore:`) are never nodes. Neither are files the adapter does not analyze (docs, JSON, other languages: `graph.files` of both commits): they would all show up as "folders outside architecture.yml". They are counted apart and the context line says `N files not analyzed`.

### 4.2 Changed files

`git diff --name-status -M <merge-base>` plus untracked files (as `reins review` does today). A rename counts as a change of both paths: the old path on the base side, the new one on the head side. Deleted files count for the base side only.

### 4.3 Edges between nodes

From the adapter graph: file edges `{ from, to, kind }` → node edges `A → B`, `A ≠ B`, kinds merged. Type-only imports count.

- **unchanged:** in base and head.
- **new:** in head, not in base. **Forbidden** when a new violation from `runCheck` lies on that node pair; otherwise allowed.
- **forbidden on an existing pair:** a new violation on a pair that already had an edge in base (another file now breaks the rule) draws that edge red and gets a `-` row, though the edge itself is not new.
- **removed:** in base, not in head.
- **mutual:** a new edge `A → B` whose reverse `B → A` exists in head (new or not). Both are marked mutual. A pair already mutual in base is not reported. If a file-level cycle makes `no-cycles` fire, the edge is forbidden instead. Day-to-day PRs create these, which is why v1 reports them.

**Counts in the summary:** *new dependencies* = new edges that are not forbidden, mutual ones included (two per pair); *mutual dependencies* = pairs; *violations* = new violations. A violation is **new** when its key is in the head's `check` result and not in the merge base's (both computed with the same head `architecture.yml`, no baseline, integrity left out), so a debt that was already there is never the PR's.

Shortcut that the tests use to state expectations (only changed files can add or remove imports): base edges = head edges whose `from` is unchanged, plus base edges whose `from` changed.

### 4.4 Touched, affected, new and removed domains

- **touched:** nodes with a changed file.
- **affected:** nodes not touched that hold a file importing a changed file, directly or through a barrel (`impactOf` with the adapter's `uses`, per changed file, merged; a file counted once). Direct importers only. Wording: "N files import changed code", never "whose exports changed" (unknown).
- **new domain:** in head `architecture.yml`, not in base (`showFile` at the merge base). No `architecture.yml` at the base: every head domain is new. One that exists but cannot be parsed: none is reported, with a warning.
- **removed domain:** in base `architecture.yml`, not in head.

### 4.5 Structural change

Any of: a new or removed domain, a no-domain folder with changed files, a new or removed node edge, a new mutual pair, a new violation. Otherwise the short form.

## 5. Base graph

The adapter reads files from disk (dependency-cruiser), so the base needs a checkout:

1. `git worktree add --detach .reins/tmp/pr-map-base-<pid> <merge-base>` (inside the repo, gitignored by `reins install`; one folder per process, so two runs never share it; folders of dead processes are removed first).
2. `adapter.prepareCheckout(worktreeDir, repoRoot)`, when the adapter has it (optional contract field, [adapter-contract.md](../adapter-contract.md)). Core stays unaware of `node_modules`.
3. `analyze(<tmp>, …, { loaded: head adapter, config: head config })` from `packages/cli/src/commands/check.js`: the base graph is built by the **head** adapter and config, never by an adapter resolved inside the checkout (a PR that changes the adapter would otherwise look like a change in the code; the worktree sits inside the repo, so resolution can also silently walk up to the head's copy).
4. Remove the worktree in a `finally`, also on errors and on SIGINT/SIGTERM.

**`prepareCheckout` in adapter-js** (`packages/adapters/js/src/checkout.js`) mirrors every `node_modules` of the main checkout **entry by entry**, never whole folders: it creates real `node_modules` and `@scope` directories in the worktree and, for each entry of the main checkout:
- a symlink whose target resolves inside the repo and **not** under a `node_modules` (a workspace package) is recreated with the **same relative target**, so it resolves to the worktree's copy (the base version); an absolute one is pointed at the worktree's copy;
- anything else (a link into pnpm's store, a link outside the repo, a real folder of an npm layout, `.pnpm`) gets an absolute symlink to the main checkout's install;
- `.bin` is skipped; packages that do not exist at the base commit are skipped;
- Yarn Plug'n'Play (`.pnp.cjs`): no `node_modules` to mirror, so it returns a warning ("the base graph is unsupported") and `review --map` prints it on stderr.

Linking whole `node_modules` folders would resolve pnpm's relative workspace links against the main checkout, i.e. the head versions.

Cost: a second full graph run. Phase 2 can add a `files` option to the adapter contract.

**Phase 0b result (2026-11-08, this monorepo, [VERIFIED.md P14](../VERIFIED.md#p14-base-graph-through-a-git-worktree--pass-with-a-mirrored-node_modules)):**
- Without `prepareCheckout`, base = HEAD gave **25 new edges** (all to `@agentreins/core`, which pnpm resolves through `packages/<pkg>/node_modules`), inside or outside the repo, with no warning. The original plan (worktree inside the repo so resolution walks up to the root `node_modules`; drop base edges outside the worktree) did not work: the root has no `@agentreins/core`, and no edge pointed outside.
- With the mirror: 225 base edges = 225 head edges, **zero new and zero removed**. Measured here: worktree add ~100 ms, mirror ~7 ms, base analysis ~130 ms, worktree remove ~55 ms; head graph 520–860 ms (it is the first analysis of the process, so it pays for loading dependency-cruiser and TypeScript).
- Automated: `packages/cli/test/pr-map.test.js` (temp git repo, clean commit, workspace packages linked as pnpm does: base = HEAD gives the short form with no edges; it fails without `prepareCheckout`) and `packages/adapters/js/test/checkout.test.js`.

## 6. Where the code goes

Dependency direction stays `cli` → `adapters` → `core`; `core` knows no framework and does no I/O.

| Piece | Where | Notes |
| --- | --- | --- |
| `prStructure({ baseEdges, headEdges, changed, config, baseConfig, baseDomainNames, newViolations, impacts, base, analyzed })` → model | `packages/core/src/prmap/index.js` | Pure. Nodes (kind, files, touched, affected), edges (status, example file pairs, rule), counts, form. |
| `renderPrMap(model)` → Markdown | `packages/core/src/prmap/render.js` | Pure. Templates, Mermaid, ids, escaping, limits, size cap. |
| Exports | `packages/core/src/index.js` | Not `contract/`: adapters don't need them. |
| `reins review --map [--base <ref>]` | `packages/cli/src/commands/review.js`, I/O in `packages/cli/src/pr-map.js` | I/O: merge base (`pickBaseRef`), changed files, head and base graphs, base `architecture.yml`, `runCheck` new violations, `impactOf` per changed file. Prints Markdown to stdout. Exit 0 even with violations; 2 if it could not run (any failure becomes a message with git's own stderr, never a stack trace). Git is read with `-z`, so accented names are never quoted. |
| CI step | `templates/.github/workflows/reins.yml` and `.github/workflows/reins.yml` | Section 7. |

Tests next to the code (`node:test`): one per definition in section 4; render snapshots equal to the three examples for their inputs (build the model inputs from the examples); ids and escaping (`end`, `api-client`, `app/(auth)/[id]`); size cap; CLI test on a temp git repo with a fixture app, including base = HEAD → short form.

## 7. CI

Added to the existing `reins` job (a separate job would repeat checkout and install):

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write # labels live under issues: lets the step create reins:no-map
concurrency:
  group: reins-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
# … after `npx reins check`:
      - name: Architecture map comment
        if: "!cancelled() && github.event_name == 'pull_request' && !contains(github.event.pull_request.labels.*.name, 'reins:no-map')"
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
          BASE_REF: ${{ github.base_ref }}
          PR_NUMBER: ${{ github.event.number }}
          REPO: ${{ github.repository }}
        run: |
          gh label create reins:no-map --description "Skip the reins architecture map comment" --color ededed 2>/dev/null || true
          npx reins review --map --base "origin/$BASE_REF" > "$RUNNER_TEMP/pr-map.md"
          id=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate \
            --jq '.[] | select(.body | startswith("<!-- reins:pr-map -->")) | .id' | sed -n 1p)
          if [ -n "$id" ]; then
            gh api -X PATCH "repos/$REPO/issues/comments/$id" -F body=@"$RUNNER_TEMP/pr-map.md"
          else
            gh pr comment "$PR_NUMBER" --body-file "$RUNNER_TEMP/pr-map.md"
          fi
```

- `!cancelled()`: the map matters most when `check` fails, but a cancelled run (a newer push) must not post a stale comment.
- `concurrency` per PR: two quick pushes cannot both find no comment and create two; a newer push cancels the older run.
- The comment is written to `$RUNNER_TEMP`, outside the checkout, so it is never a changed file; values from the event go through `env:`, never into the script text (a branch name is attacker-controlled).
- Several comments with the marker (an old race): only the first id is used (`sed -n 1p`, not `head`, which would close the pipe under `pipefail`).
- `continue-on-error`: PRs from forks get a read-only token; the comment fails, the job doesn't.
- Find by marker, never `--edit-last`: other bots' comments are never touched.

Turning it off:
- **One PR:** add the label `reins:no-map`. The step creates the label on its first run (needs `issues: write`; on fork PRs it can't and simply skips), so nobody creates it by hand and `install` needs no GitHub access. Applying a label needs triage access or more on the repo, which reviewers have. The step skips; an existing comment stays as it was. Labeling triggers no new run, so it applies from the next push.
- **The whole repo:** delete the step from `.github/workflows/reins.yml`. `reins install` writes that file once and only overwrites it with `--force`, and `sync` never touches it, so the removal sticks. The person asks the agent; README says how.
- No setting in `architecture.yml`: the step is the switch, and a second one would need a schema change for no gain.

Existing repos: `install` never rewrites the workflow, so repos installed before this feature don't get the step. README and the release notes give the step to paste (the agent adds it when asked); `reins install --force` would also discard the team's own edits to the file.

## 8. Phases

| Phase | Who | What | Done when |
| --- | --- | --- | --- |
| 0a | person | Render the examples on GitHub. | **Dark theme done 2026-11-08** (gist; `docs/VERIFIED.md` P13). Pending: light theme, and a real PR comment (not a gist). |
| 0b | agent | Spike the base graph (section 5) on this repo and on one Next fixture. | **Done 2026-11-08.** Base = HEAD gives zero new/removed edges on this monorepo, with `prepareCheckout` (section 5). Recorded in `docs/VERIFIED.md` P14. Not tried on a Next fixture. |
| 0c | person + agent | Count structural edges in 3–4 real large repvue-next PRs. | The map-skipped limit of 3.1 set from data. |
| 1 | agent | Model (`prmap/index.js`) + tests. | **Done.** Every definition of section 4 has a test (`prmap-model.test.js`). |
| 2 | agent | Renderer (`prmap/render.js`) + tests. | **Done.** Snapshots equal the three examples; ids, escaping, 20-edge skip, diff/Details caps and a 300-domain size cap tested (`prmap-render.test.js`). |
| 3 | agent | `reins review --map`, base graph, CLI test. | **Done.** Prints the comment for a fixture PR; base = HEAD prints the short form (`pr-map.test.js`). |
| 4 | agent | CI step in both workflows; README (diagram of the flow), `docs/STATUS.md` (experimental), `docs/VERIFIED.md` (unverified: marker search, fork tokens, the label condition, label creation with `issues: write`, light theme until 0a), `docs/DECISIONS.md` (worktree base graph, words before picture, prefix-as-severity in the diff block, violet for new, always comment, mutual in v1). | `pnpm lint && pnpm test && pnpm self-check` pass; `reins check` and `reins doctor` clean. **Done** except what the person has to run on GitHub (VERIFIED P14 lists it). |

Phase 0b first: its result can change section 5. Phases 1–4 can be one implementing session.

## 9. Rejected while designing (don't bring back)

- A file-level force graph (grasp-style): hundreds of nodes, no decision comes out of it.
- Mermaid subgraphs per layer: tall, crossing layout on GitHub.
- Bare arrows (`A → B`) as the only text: read backwards by a tester. Verbs in the diff block, example in the legend.
- Green for new dependencies on the map: reads as "approved".
- A "Needs a decision" checklist: repeated the details.
- No comment when nothing changed: silence is ambiguous (did the job fail?).
- A folded map in the short form: the person wants the map always visible.
- `--edit-last` to update the comment: can edit another bot's comment.
- Separate "full" and "focused" maps with unchanged context edges: one rule (draw only what changed) covers small and large PRs; context edges added noise.

## 10. Phase 2 (only if real use asks)

- Affected by exports: count only importers of exports that changed.
- Adapter contract `files` option to skip the full base graph.
- GitLab and other CI providers.
- A `check` rule (warn) for files in no domain.
- An image fallback if Mermaid proves unreadable on real PRs.
- `reins review --map` locally for the agent's own task (anchor commit from `triage.log`).

### When a second adapter arrives (Ruby/Packwerk, or a full-stack framework)

Not for v1 (only the JS adapter exists, and `architecture.yml` takes one adapter). Keep the model ready for it:
- **Files the adapter doesn't analyze:** a PR touching them should say so (`12 files not analyzed (.rb): this map covers JS only`), so nobody reads "no structural changes" as "the back end didn't change". Possible as soon as the CLI compares changed files with the adapter's `files`.
- **Several graphs in one repo** (JS front, Rails back): nodes would carry their adapter; the map shows both sides, with no import edges between them.
- **Front ↔ back coupling is the API contract**, not imports. Seeing it needs another source (OpenAPI schema, generated client, route list): a separate kind of edge, designed with the Ruby adapter.
- **Full-stack JS (Next with API routes, server actions):** already one graph today; works if `architecture.yml` declares the server side as layers or domains.
