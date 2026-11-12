---
paths: ["packages/core/src/**"]
---
# core

## Purpose
Framework-agnostic engine of reins: validates `architecture.yml`, runs `check` (rules + baseline + integrity), `doctor`, notes, backlog and notebook parsing, and defines the adapter contract. Used by the CLI and, through `contract/` only, by adapters.

## Map
- Public API: `packages/core/src/index.js` (for the CLI), `packages/core/src/contract/index.js` (the only entry adapters may import; enforced by `exports`)
- Used by: packages/cli (14), packages/core (9), packages/adapters (5). Depends on: nothing outside the module (Node, git, `yaml`)
- `contract/index.js`: `CONTRACT_VERSION`, `Edge`/`Adapter`/`Preset` typedefs, `validateAdapter`, `validateEdges`, `normalizeGraph`; re-exports `matchesAny`.
- `config/index.js`: parses and validates `architecture.yml`, collects every problem with its field path; rule defaults. `adapters: [js, rust]` (written by `init` as `adapters: [js]`); the older `adapter: js` is refused with the fix (`sync` migrates it); `adapterNamesOf(raw)` lets the CLI load adapters before validating. 2026-11-11: optional `base` (a branch name, used as written; the CLI reads it, the core only validates it).
- `check/index.js`: `evaluate` (core rules on merged edges) and `runCheck` (marks violations new/baseline, stale entries, `--files` filter).
- `check/rules/*.js`: `layer-direction`, `domain-boundary`, `no-cycles`; each exports `id` and `run(edges, config)`.
- `check/baseline.js`, `check/integrity.js`: baseline file format; integrity compares with the merge base via `git.js`, or with `since` when the CLI already chose the commit (the branch start), named by `label`.
- `glob.js`: own glob matcher (`*`, `**`, `?`, `{a,b}`), shared with adapters.
- `doctor/`: process rules (triage, notebook, notes, AGENTS.md size); `progress-edit.js` edits the notebook safely. `triage.js`: `parseTriageLog` (optional trailing `commit:`/`task:` fields), `formatTriageLine`, `taskAnchor`, `checkTriage` (with an `anchor`, only the lines with that commit count). `progress.js`: `notebookFile(branch, task?)`, `taskFolder`, `HEADER_RE` with optional `task:`/`session:`, `summarizeNotebook`, pure `cleanupPlan` (7-day margin).
- `prmap/index.js`: `prStructure` (nodes, edges new/removed/mutual/forbidden/affected, touched, affected, structural or not) → plain model; `prmap/render.js`: `renderPrMap` (Markdown, Mermaid, caps, size limit). 2026-11-10: optional `zones` (`{ name, files }[]`, one per adapter from the CLI) make a node a domain in a zone (`name` `billing (rails)`, `label`, `zone`) and the map one `subgraph` per zone; an import between two zones of one domain is an edge. Without zones the output is unchanged (the snapshots prove it). Spec: `docs/proposals/pr-map.md`; the three examples in `docs/proposals/pr-map-examples/` are the snapshot targets of `prmap-render.test.js`.
- `notes/`, `backlog/`, `report/`: note parsing and drafting, audit backlog lines, text/JSON report format. `notesFor` returns the most general note first (shortest matching glob), so a module's note comes before its parts'. Parts live in `.reins/notes/<module>/<part>.md` (`parentNoteFile`, `pathsInside`); doctor's `note-layout` checks that layout. `notes/suggest.js` (2026-11-12): `suggestNotes(reason, notes, folders)` (plain word matching for `triage` without files: names/paths and covered folder names 3 points, body 1, +1 for a word repeated 5+ times; drops notes under a third of the best), `words`; `notePurpose` in `notes/index.js`. `notes/stale.js`: `rankStaleNotes` (commits to a note's paths since the note last changed, from history the CLI reads).

## How it works
The CLI reads files, git state and the adapter's graph, and passes them in. `evaluate` drops `ignore`d edges, merges duplicates (one edge per from/to with all its kinds) and runs each rule; `runCheck` adds `extra` violations (integrity, adapter rules), compares keys with the baseline and returns `ok` = no new error. `report/` formats the result. `doctor` and the notes/backlog/progress helpers follow the same pattern: pure functions over text the caller loads.

## Decisions
- 2026-11-10: `scopeSignals` takes `notCounted` globs (`triage.not_counted` in doctor.yml; default: Markdown and usual test names): docs and tests that come along with a change count neither as files nor as domains. `parseDoctorConfig` accepts that one list (a list replaces the default). `impact-map` still counts every importer.
- 2026-11-10: the `Preset` typedef in `contract/index.js` documents the optional fields that tell `reins init` about a language (`sources`, `tests`, `index_files`, `orphans_ignore`, `ignore_kinds`, `route_domains_from`, `route_segments`, `source_roots`). Types only: the core never reads a preset, the CLI does (`init/conventions.js`). Contract still version 1.
- 2026-11-04: the core never opens source files and knows no framework; it only sees `{ from, to, kind }` edges. Anything JS/Vite/Next lives in adapters.
- 2026-11-09: doctor's `note-missing` also fires, at any level, for every domain without a note when `architecture.yml` changed (`planChanged`): domains added to the plan have no changed code, so they never got a note. Coverage uses `repoFiles` when given, else note globs overlapping the domain's.
- 2026-11-12: doctor's `note-uncovered`: a medium/large diff changed a direct subfolder of a note's `<dir>/**` with ≥ `notes.uncovered_min_files` files (default 10, 0 = off) that the note never names (case-insensitive) and no part note covers. Only touched folders, so it never floods a fresh `init`.
- 2026-11-04: own glob matcher instead of a dependency (`path.matchesGlob` is experimental in Node 22). First matching layer/domain wins.
- 2026-11-04: baseline is sorted, has no timestamps, keys are `rule|from|to` (cycles: `no-cycles|<sorted files>`), so diffs in PRs are clean and a growing cycle counts as new.
- 2026-11-04: integrity only makes changes visible (warn by default); it reports a changed `architecture.yml` and a growing baseline, never first adoption or shrinking.
- 2026-11-04: contract grew with optional fields (`files`, `entries`, `warnings`, `rules`/`evaluate`, presets) while staying at version 1. 2026-11-05: `barrels` and `uses`, read by `init`; `impact` reads `uses` too (importers behind a barrel).
- 2026-11-07: default `agents_md.max_lines` is 45 (was 30): the managed reins rules block (~19 lines) must fit next to a repo's own rules and the notes index.
- 2026-11-08: the PR map model is pure data and the renderer pure templates, so the CLI does all I/O and tests build models by hand. Only files the adapter analyzes become nodes; new violations are head's minus the merge base's. See `docs/DECISIONS.md`.
- 2026-11-09 (first real PR): the context line counts every changed file, like GitHub, with one short note for the ones off the map (`34 files (21 not on the map: they don't change the architecture)`); a reviewer could not reconcile `13 files` with GitHub's 34, and listing extensions and folders was rejected as noise. `touched:`/`affected:` appear only when there is no map: with one they are its boxes. See `docs/DECISIONS.md`.

## Traps
- `note-dead-refs` only checks backticked paths whose first folder exists at the repo root: paths relative to a module (`src/main.js` in a package's note) are skipped, not checked.
- Keep `check` and `doctor` pure: no fs/git reads there (except `check/integrity.js` and `git.js`). The CLI does the I/O.
- Never import from `cli` or adapters. Anything adapters need must be exported from `contract/` (that is why `matchesAny` is re-exported there).
- Integrity findings never go into the baseline and are never marked `baseline`.
- With `rules:` present, unlisted rules are off except `integrity` (stays `warn` unless explicitly `off`). Unknown config keys are errors on purpose.
- `renderPrMap` output is fixed byte for byte by the examples: change a template and update the example and the docs together. Node ids are `n1…` in render order, so `linkStyle` indexes are computed, never written by hand. A map with no edges is `flowchart TB` on purpose: in `LR` Mermaid stacks loose boxes in one tall column (seen on GitHub, 2026-11-09).
- With `files` (pre-commit) no stale entries are computed; cycles still use the full graph.
