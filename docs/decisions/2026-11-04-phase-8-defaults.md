# Phase 8 defaults (`install`, distribution; experimental)

| Topic | Decision | Why |
| --- | --- | --- |
| `install` vs. documented steps | A command, additive and idempotent: copies missing `.reins/` sources, appends missing `.gitignore` lines, adds a `reins:check` script, wires the hook, writes the CI workflow, runs `sync`. Never overwrites existing files (the workflow only with `--force`), never installs packages; `--dry-run`, `--skip-hook`, `--skip-ci` | Fewer manual steps means fewer half-installed repos |
| Hook manager | Uses what the repo has: lefthook (config file or dependency) first, then Husky (`.husky/` or dependency). Neither → explains how to add one; no hook is written | Task: "Husky or lefthook, whichever the repo already uses". Installing one would be installing packages |
| Husky hook | Appends `sh .reins/hooks/pre-commit.sh` to `.husky/pre-commit` (no shebang: Husky 9 runs hook files with `sh`) | Husky 9 format |
| lefthook | Adds `pre-commit.commands.reins.run` with the `yaml` Document API, keeping comments and other commands | Editing YAML as text is fragile |
| CI workflow | `.github/workflows/reins.yml`: PRs and pushes to the default branch; `fetch-depth: 0` (integrity needs the base); Node 22; setup and install per package manager (npm `npm ci`, pnpm `pnpm/action-setup@v4` with the major version from `packageManager` or the local pnpm, yarn, bun); then only `npx reins check` | Design: CI runs only `check` |
| `.gitignore` | `.reins/backlog/`, `.reins/progress/`, `.reins/init-report.md` | Local state; the init report is for review only |
| Distribution without publishing | Tarballs committed in each repo under `vendor/reins/` and installed with relative `file:` paths | Verified: installing from a path outside the repo writes that path into the lockfile, and CI can't reach it |
| Branch protection | Printed as a next step and documented; not automated | Needs repo admin rights; outward-facing |
