# Changelog

## 0.4.0 · 2026-11-05

- Notes for the parts of a module. `reins init` drafts, for each route domain, one note per part with its own logic (e.g. `(companies)/companies/[slug]/salaries`): it looks through `(group)` and `[param]` folders and single-folder chains, needs 2+ source files, at most 12 per domain (the rest are listed). Parts are notes, not domains: no new rules.
- Layout: `.reins/notes/<module>.md` (shared context, lists its parts) plus `.reins/notes/<module>/<part>.md` (only what is specific), one level deep. Notes are read from those folders; existing flat notes keep working.
- An agent working in a part gets the module's note first, then the part's (`notesFor` orders from general to specific). The `AGENTS.md` index puts the parts on their module's line.
- `reins notes new <folder>` on a folder inside a domain drafts a part (`.reins/notes/<domain>/<part>.md`); `--name` accepts `<module>/<part>`.
- New doctor rule `note-layout` (warn): a note more than one folder deep, a part without its module note, or a part whose paths are outside its module.
- Skills `reins-notes` and `reins-done` know about parts. `reins install` never overwrites, so repos installed with 0.3.0 get the new text by deleting `.reins/skills/notes/` and `.reins/skills/done/`, then running `reins install` and `reins sync`.

## 0.3.0 · 2026-11-04

- `reins init` on a repo organized by routes (no `features/` or `modules/`): each route folder becomes a domain and gets a module note. Presets gained `route_domains_from`: `src/routes/*`, `src/pages/*`, `src/views/*`, `src/screens/*` (Vite), `app/*` (Next app) and `pages/*` (Next pages), with or without `src/`. Next `[param]` folders are looked through (`app/[lang]/flights` → `flights`), catch-alls and `_private` folders are skipped, `(group)` folders are named without parentheses. A route's public API is its `index.*`, or else what the router imports plus its entry files (`page.tsx`).
- `reins init` says when it found no domains, and how to draft notes anyway (`reins notes new <folder>`).

## 0.2.1 · 2026-11-04

- Each package has a README on npm (the CLI carries the full README of the repository) and keywords; links point to `github.com/fredarcito/reins`.

## 0.2.0 · 2026-11-04

- New skill `/reins-backlog`: what is pending in the backlog, what to do next (checked against the code), add, close or drop items. `AGENTS.md` (template) says where pending work lives.
- Skills have short names: `/reins-arch`, `/reins-notes`, `/reins-agent`, `/reins-done` (was `reins-close-task`), `/reins-audit`. Repos installed with 0.1.0: delete `.reins/skills/close-task/`, then run `reins install` (adds the new skills) and `reins sync` (removes the old generated one).
- New skill `reins-arch` (`/reins-arch`): the agent checks the plan against the code and proposes changes with evidence; it applies nothing until the person approves, never invents an exception's reason, never bends the plan to make the check pass.
- New skill `reins-agent` (`/reins-agent`): creates a subagent in `.reins/agents/` (read-only by default, fewest tools) and generates it for Claude Code.
- `reins check --coverage` (and `--json`): files per layer and domain, folders outside every layer, imports between layers, exceptions and the baseline.
- New skill `reins-notes` (`/reins-notes` in Claude Code): the agent fills in the `TODO` lines of the module notes from the code, never invents a decision, and leaves `- ? question` lines for what only the team knows. `init`, `notes new` and `doctor` point to it.
- `reins progress new` uses the repo's notebook templates in `.reins/templates/` first (so a team can adapt them), falling back to the packaged ones, and refuses a template that doesn't produce a valid notebook.

## 0.1.0 · 2026-11-04

First version, on npm: `npm install -D @agentreins/cli @agentreins/adapter-js`. Without a registry: [`docs/team-install.md`](docs/team-install.md).

- **Name: reins** (called harness during development). Packages `@agentreins/cli` (command `reins`: `npx reins check`, no `--no-install` needed), `@agentreins/core`, `@agentreins/adapter-js`, folder `.reins/`, markers `reins:notes`, generated skills and agents `reins-*`, workflow `reins.yml`.

### Context between sessions (experimental)

- Context between sessions: module notes with a fixed shape (Purpose, Map, How it works, Decisions, Traps); `reins notes new <domain|folder>` drafts one from the import graph; `reins resume` prints the branch notebook, the changed files and their notes.
- Claude Code: `reins sync` adds a `SessionStart` hook (`startup`, `compact`, `clear`) running `reins resume --hook`, so the notebook and the module notes come back after a compaction.
- Fixed: after a compaction the notes hook stayed silent, because the session id doesn't change.
- `reins doctor`: `note-missing`, `note-outdated` (medium and large diffs), `note-draft`, `note-size` (`notes.max_lines` in `doctor.yml`, default 60).
- `close-task` updates the module notes as part of closing.
- `reins init` drafts a module note per domain that has none; `reins install` appends the notes index block to an existing `AGENTS.md`; `reins notes new --name`.


### Stable (enforced by tools)

- `reins check`: `layer-direction`, `domain-boundary`, `no-cycles`, baseline (only new violations fail), `integrity` (changes to `architecture.yml`, a growing baseline, generated files out of sync), `--files` for the pre-commit hook, `--json` for agents, `--update-baseline`.
- `reins init`: drafts `architecture.yml` (layers ordered by import direction, one domain per `features/*` folder), `baseline.json` and a review report (cycles, doubtful dependencies, orphans, warnings). Never overwrites without confirmation.
- `architecture.yml` validation with every problem reported at once; `ignore:` globs; `allow:` exceptions with a reason.
- `@agentreins/adapter-js`: Vite + React and Next (app and pages router), plain JS/JSX or TypeScript; `@/` aliases from `jsconfig`/`tsconfig` (with `extends` and `references`) and `vite.config`; monorepo workspaces; presets `vite-react`, `next-app`, `next-pages`; optional `next-server-client` rule.
- Pre-commit hook (Husky or lefthook) and a CI workflow running `reins check`.

### Experimental (guidance for agents)

- `reins install`, `sync` (+ `--check`), `notes` (+ `--hook` for Claude Code), `scope`, `doctor`, `audit`, `progress`, `review`.
- Templates: `AGENTS.md`, `CLAUDE.md`, triage/progress/multi-agent policies, notebook templates, review checklist, skills `reins-audit` and `reins-close-task`, read-only agents `reins-reviewer` and `reins-explorer`.

### Known limits

See [`docs/VERIFIED.md`](docs/VERIFIED.md#still-unverified): not yet run on GitHub Actions or a real team repo; yarn and bun untested; Claude Code permissions can be bypassed (branch protection is the real guarantee).
