# Changelog

## 0.6.0 · 2026-11-05

From running 0.5.1 on a real Next.js app (1204 files). Re-run `reins init --dry-run` after updating.

- `reins init`: a feature folder (`components/pages/companies/`) joins its route domain whole, instead of a list of its subfolders and 100+ single files. Inside a folder organized by feature, a subfolder goes to the domain with at least 2/3 of the imports into it; the other imports are frozen in the baseline and counted in the report.
- `reins init`: shared code is no longer assigned to one domain. A folder that is not organized by feature (`components/shared/`) and the lowest layer (`utils/`, `constants/`…) stay out of every domain and every note.
- `AGENTS.md` notes index: at most two paths per note, then `(+N more)`; the note keeps them all.
- Presets: the shared layer includes `constants`, `store`, `api`, `context` (and `src/config`).
- Init report: how many source files are outside every layer, and for each such folder who imports it, what it imports and the lowest layer it fits without violations. Route folders left out (lone pages, `sitemap.xml`) are explained: the layer rules still check them.

## 0.5.1 · 2026-11-05

Fixes found running 0.5.0 on a real Next.js app. Re-run `reins init --dry-run` after updating.

- Fix, `reins init` on a repo organized by routes: folders with the same route path in different groups (`(companies)/companies` and `(main)/companies`, both `/companies`) are one domain with several folders, and their parts are merged the same way, instead of `companies`, `companies-2`, `companies-3`.
- Fix: `reins init` drafts the note of a domain even when a broader note covers it (e.g. `emptyLayout.md` for a whole route group, left by an older init); before, such a domain got its parts' notes (`rating/…`) but no `rating.md`. A note under another name counts as the domain's note only if all its paths lie inside the domain, and then the parts go in that note's folder.
- Fix, parts of a route domain: a parameter folder that is a page itself (`rating/[slug]/page.js` + `index.js`, the page at `/rating/acme`) gets its own note (`rating/slug.md`) covering only its files (`[slug]/*`); before, its files only had the domain's note.

## 0.5.0 · 2026-11-05

- `reins init` on a repo organized by routes: Next route groups `(main)` are looked through like `[param]` folders (they share a layout, they are not features), so `(main)/jobs` becomes the domain `jobs`. A route folder with a single source file (a lone page) is no longer a domain; the report lists it.
- `reins init` on a repo organized by routes: a folder outside every domain that only one route domain imports (e.g. `components/pages/companies/`, `components/JobBoard/`) joins that domain, decided by the import graph, not by names. Shared folders stay out; folders mostly used by one domain are listed in the report. Notes of those domains include the folders.
- `reins init` sees through re-export files: with `import { JobBoard } from '@/components'` and a `components/index.js` barrel, the import counts for `components/JobBoard/`, not for every component. The JS adapter returns two new optional fields, `barrels` and `uses` (adapter contract still version 1); rules keep checking the real imports.
- `reins init`: a loose file only one route uses (`components/paginaContacto.js`) is added to that route's note, never to its rules; the report lists it.
- The init report says, for each domain, how many imports reach it from outside, and marks domains whose public API is only route files (`page.js`) as closed.
- Fix: the `next-server-client` rule no longer counts `import 'server-only'` or `import('next/headers')` written inside a comment, which reported client components as reaching server-only code when they didn't. The import graph was not affected (it never read comments).
- Repos that already ran `reins init`: nothing changes until you run it again. Re-running it proposes different route domains than 0.4.0 (no `(group)` domains, no one-file routes, extra folders per domain); compare with `reins init --dry-run` first.

## 0.4.0 · 2026-11-05

- Notes for the parts of a module. `reins init` drafts, for each route domain, one note per part with its own logic (e.g. `(companies)/companies/[slug]/salaries`): it looks through `(group)` and `[param]` folders and single-folder chains, needs 2+ source files, at most 12 per domain (the rest are listed). Parts are notes, not domains: no new rules.
- Layout: `.reins/notes/<module>.md` (shared context, lists its parts) plus `.reins/notes/<module>/<part>.md` (only what is specific), one level deep. Notes are read from those folders; existing flat notes keep working.
- An agent working in a part gets the module's note first, then the part's (`notesFor` orders from general to specific). The `AGENTS.md` index puts the parts on their module's line.
- `reins notes new <folder>` on a folder inside a domain drafts a part (`.reins/notes/<domain>/<part>.md`); `--name` accepts `<module>/<part>`.
- New doctor rule `note-layout` (warn): a note more than one folder deep, a part without its module note, or a part whose paths are outside its module.
- npm pages: the CLI has its own README (install, quick start, commands, skills) instead of a copy of the repository's, which npm showed empty and whose diagrams and relative links did not work there. The core and adapter READMEs gained install steps and what each package does.
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
