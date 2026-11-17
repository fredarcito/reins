# Phase 9 defaults (docs, self-check, 0.1.0)

| Topic | Decision | Why |
| --- | --- | --- |
| License | MIT, copyright fredarcito (author's decision). `license: "MIT"` in every package; `pnpm pack:all` copies `LICENSE` into each package (gitignored copies) | "Usable without problems"; the most common permissive license in the JS ecosystem |
| Version | `0.1.0` in the three packages and the root, not published. `CHANGELOG.md` | First pilot version |
| Self-check | `.reins/architecture.yml` for this repo (`cli` > `adapters` > `core`, `core` as a domain whose public API is `index.js` + `contract/`), checked two ways by `pnpm self-check` (in CI): dependency-cruiser alone with forbidden rules, and `reins check` from source, plus a guard that both see `cli → core` imports | Chicken and egg: a broken reins can't vouch for itself; the guard catches the "zero edges, still green" failure found in this phase |
| `ignore:` in `architecture.yml` | Optional globs removed from the analysis (core drops edges, the adapter drops files and warnings) | This repo's examples and fixtures; real repos have generated code and stories too |
| Workspace resolution | The adapter passes `exportsFields: ['exports']` and `conditionNames` to dependency-cruiser and works from the real root path | Bug found in this phase: imports of `exports`-only workspace packages disappeared |
| Doctor counts | Triage counts only code files: `.reins/`, `.claude/`, `AGENTS.md`, `CLAUDE.md` don't count; `architecture.yml` is still detected | Bug found in the walkthrough: a one-file change looked like four |
| Diagrams lint | `pnpm lint` rejects mermaid labels with HTML entities, quotes, `<`, `>` or `|`, and reserved node ids | GitHub failed to render one diagram |
| Pilot | [`team-adoption.md`](../team-adoption.md) + [`PILOT.md`](../PILOT.md) template; thresholds decided before starting | Design: metrics and keep/simplify/drop criteria defined in advance |
| `npx --no-install harness` (until the rename to reins) | Every doc, template, skill, policy, hook and CI step ran the CLI with `--no-install` | An unrelated public npm package is called `harness` (0.0.6): a bare `npx harness` in a repo without the CLI installed would offer to download and run it. Dropped with the rename: see "Name" below |
