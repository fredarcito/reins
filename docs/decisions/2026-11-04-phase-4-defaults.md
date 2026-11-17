# Phase 4 defaults (CLI `check` and `init`)

| Topic | Decision | Why |
| --- | --- | --- |
| Files in a consumer repo | `.reins/architecture.yml`, `.reins/baseline.json`, `.reins/init-report.md` | Design layout. The report is for review only; phase 8 will add it to `.gitignore` |
| Adapter resolution | From the repo root (then optional extra folders, used by tests): `@agentreins/adapter-<x>`, then `reins-adapter-<x>`. Reads `reins.contract` from the package's `package.json` (falls back to walking up from the entry file), refuses a mismatch, validates the module | Verified in phase 0 that pnpm only warns on peer mismatches |
| Missing adapter | `init` guesses `js` when there is a `package.json` and prints the install command for the repo's package manager (pnpm/yarn/bun/npm by lockfile). Never installs | Design |
| Contract growth | Optional `presets`, `suggestPreset(repoPath)`, `loadPreset(name)` on adapters; presets may list `default_rules`. Still contract 1 | `init` needs the preset; the core can't know frameworks |
| Exit codes | `0` no new errors, `1` new errors, `2` could not run | Hooks and CI only need "did it fail"; `2` separates broken setup from violations |
| Output | The report always goes to stdout (pass or fail); usage and setup errors to stderr. `--json` adds `warnings` | Hooks and agents read one stream |
| Missing baseline | Treated as empty, with a warning | A repo without baseline still gets a useful result |
| Base ref for integrity | `--base`, then the branch start (reflog), `$REINS_BASE`, `origin/$GITHUB_BASE_REF`, `base:` in `architecture.yml`, `origin/HEAD`, `origin/main`, `origin/master`, `main`, `master`; first that exists. None → integrity skipped with a warning. Since 2026-11-11, see "Comparison base" below | Works locally and in CI without configuration |
| `--files` | Comma-separated or repeated; relative to the current folder; real paths (symlinks resolved) | Hooks pass staged files; macOS temp folders are symlinks (bug found by the tests) |
| `--update-baseline` | Rewrites the whole baseline; refused together with `--files`; prints `+frozen / -fixed` | Integrity flags a growing baseline in the PR anyway |
| `init` layers | Preset layers whose globs match files, ordered by the dominant direction of runtime imports (type-only ignored); ties and loops keep the preset order and are reported | Design: "infer layers by dominant direction" |
| `init` domains | One per folder matching the preset's `domains_from` (e.g. `src/features/*`); public API = its `index.*`, or a placeholder flagged in the report. With no such folder, one per folder matching `route_domains_from` (`app/*`, `src/routes/*`…): Next `[param]` folders are looked through, catch-alls and `_private` skipped, `(group)` named without parentheses; public API = its `index.*`, else the files imported from outside plus its entries (`page.tsx`) | Design: "subfolders of features/"; repos organized by routes had no domains and so no module notes (2026-11-04) |
| `init` rules | Three core rules `error`; `ignore_kinds: [type]` when the repo has TypeScript; `integrity` `warn`; preset `default_rules` (`next-server-client`) as `warn` | Type-only imports rarely matter; a new adapter rule shouldn't block on day one |
| `init` safety | Asks before overwriting `architecture.yml`/`baseline.json`; without a terminal it refuses and suggests `--force` or `--dry-run`. The draft is validated by running the real analysis on it before writing | Design: never overwrite without confirmation |
| Orphans | Source files not imported, not entries, not tests/stories, not `*.config.*`, not `.d.ts` | Report only; no rule |
| Trying it before phase 8 | `pnpm pack:all` + [`docs/try-it.md`](../try-it.md) | The validation gate needs it now |
