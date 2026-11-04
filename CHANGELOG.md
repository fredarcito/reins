# Changelog

## Unreleased

### Experimental (guidance for agents)

- Context between sessions: module notes with a fixed shape (Purpose, Map, How it works, Decisions, Traps); `harness notes new <domain|folder>` drafts one from the import graph; `harness resume` prints the branch notebook, the changed files and their notes.
- Claude Code: `harness sync` adds a `SessionStart` hook (`startup`, `compact`, `clear`) running `harness resume --hook`, so the notebook and the module notes come back after a compaction.
- Fixed: after a compaction the notes hook stayed silent, because the session id doesn't change.
- `harness doctor`: `note-missing`, `note-outdated` (medium and large diffs), `note-draft`, `note-size` (`notes.max_lines` in `doctor.yml`, default 60).
- `close-task` updates the module notes as part of closing.
- `harness init` drafts a module note per domain that has none; `harness install` appends the notes index block to an existing `AGENTS.md`; `harness notes new --name`.

## 0.1.0 · 2026-11-04 (not published)

First version, for the team pilot. Install from tarballs: [`docs/team-install.md`](docs/team-install.md).

### Stable (enforced by tools)

- `harness check`: `layer-direction`, `domain-boundary`, `no-cycles`, baseline (only new violations fail), `integrity` (changes to `architecture.yml`, a growing baseline, generated files out of sync), `--files` for the pre-commit hook, `--json` for agents, `--update-baseline`.
- `harness init`: drafts `architecture.yml` (layers ordered by import direction, one domain per `features/*` folder), `baseline.json` and a review report (cycles, doubtful dependencies, orphans, warnings). Never overwrites without confirmation.
- `architecture.yml` validation with every problem reported at once; `ignore:` globs; `allow:` exceptions with a reason.
- `@harness/adapter-js`: Vite + React and Next (app and pages router), plain JS/JSX or TypeScript; `@/` aliases from `jsconfig`/`tsconfig` (with `extends` and `references`) and `vite.config`; monorepo workspaces; presets `vite-react`, `next-app`, `next-pages`; optional `next-server-client` rule.
- Pre-commit hook (Husky or lefthook) and a CI workflow running `harness check`.

### Experimental (guidance for agents)

- `harness install`, `sync` (+ `--check`), `notes` (+ `--hook` for Claude Code), `scope`, `doctor`, `audit`, `progress`, `review`.
- Templates: `AGENTS.md`, `CLAUDE.md`, triage/progress/multi-agent policies, notebook templates, review checklist, skills `harness-audit` and `harness-close-task`, read-only agents `harness-reviewer` and `harness-explorer`.

### Known limits

See [`docs/VERIFIED.md`](docs/VERIFIED.md#still-unverified): not yet run on GitHub Actions or a real team repo; yarn and bun untested; Claude Code permissions can be bypassed (branch protection is the real guarantee).
