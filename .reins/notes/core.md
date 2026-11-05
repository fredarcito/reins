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
- `config/index.js`: parses and validates `architecture.yml`, collects every problem with its field path; rule defaults.
- `check/index.js`: `evaluate` (core rules on merged edges) and `runCheck` (marks violations new/baseline, stale entries, `--files` filter).
- `check/rules/*.js`: `layer-direction`, `domain-boundary`, `no-cycles`; each exports `id` and `run(edges, config)`.
- `check/baseline.js`, `check/integrity.js`: baseline file format; integrity compares with the merge base via `git.js`.
- `glob.js`: own glob matcher (`*`, `**`, `?`, `{a,b}`), shared with adapters.
- `doctor/`: process rules (triage, notebook, notes, AGENTS.md size); `progress-edit.js` edits the notebook safely.
- `notes/`, `backlog/`, `report/`: note parsing and drafting, audit backlog lines, text/JSON report format. `notesFor` returns the most general note first (shortest matching glob), so a module's note comes before its parts'. Parts live in `.reins/notes/<module>/<part>.md` (`parentNoteFile`, `pathsInside`); doctor's `note-layout` checks that layout.

## How it works
The CLI reads files, git state and the adapter's graph, and passes them in. `evaluate` drops `ignore`d edges, merges duplicates (one edge per from/to with all its kinds) and runs each rule; `runCheck` adds `extra` violations (integrity, adapter rules), compares keys with the baseline and returns `ok` = no new error. `report/` formats the result. `doctor` and the notes/backlog/progress helpers follow the same pattern: pure functions over text the caller loads.

## Decisions
- 2026-11-04: the core never opens source files and knows no framework; it only sees `{ from, to, kind }` edges. Anything JS/Vite/Next lives in adapters.
- 2026-11-04: own glob matcher instead of a dependency (`path.matchesGlob` is experimental in Node 22). First matching layer/domain wins.
- 2026-11-04: baseline is sorted, has no timestamps, keys are `rule|from|to` (cycles: `no-cycles|<sorted files>`), so diffs in PRs are clean and a growing cycle counts as new.
- 2026-11-04: integrity only makes changes visible (warn by default); it reports a changed `architecture.yml` and a growing baseline, never first adoption or shrinking.
- 2026-11-04: contract grew with optional fields (`files`, `entries`, `warnings`, `rules`/`evaluate`, presets) while staying at version 1. 2026-11-05: `barrels` and `uses`, read only by `init`.

## Traps
- Keep `check` and `doctor` pure: no fs/git reads there (except `check/integrity.js` and `git.js`). The CLI does the I/O.
- Never import from `cli` or adapters. Anything adapters need must be exported from `contract/` (that is why `matchesAny` is re-exported there).
- Integrity findings never go into the baseline and are never marked `baseline`.
- With `rules:` present, unlisted rules are off except `integrity` (stays `warn` unless explicitly `off`). Unknown config keys are errors on purpose.
- With `files` (pre-commit) no stale entries are computed; cycles still use the full graph.
