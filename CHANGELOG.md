# Changelog

## 0.16.0 · 2026-11-11

reins compares a branch with where it started, so tasks cut from `staging` or from a feature branch show only their own files.

```bash
npx reins update
```

- **Compared with where the branch started, with nothing to configure.** Locally, `check`, `review`, the pull request map, `doctor` and `resume` used to compare with `origin/HEAD` (usually `main`). On a branch cut from `staging`, everything `staging` had ahead of `main` counted as the task's: `resume` brought notes of modules the task never touched, `doctor` judged the level and the notes against them, and the integrity rule flagged, on every commit, an `architecture.yml` change already approved on `staging`. Now reins uses the commit the branch was created from, which git records when you run `git checkout -b` or `git switch -c`, and after merging newer `staging` into the task it leaves `staging`'s work out too. In CI nothing changes: the pull request's target decides. The output says what it compared with.
- **`base:` in `architecture.yml`.** For branches without that record (fetched from a teammate, rebased, older than 90 days), a team can write `base: origin/staging` once, for everyone. It is used as written: `staging` is each person's local copy, `origin/staging` GitHub's. `reins init` and `reins update` suggest it when `origin/staging` or `origin/develop` exists; the agent asks you first, since in some teams `staging` is only a deploy branch.
- **No more `REINS_BASE` in every shell.** If you set `REINS_BASE` to work around this, you can remove it: where the branch started now comes first, so a fixed `REINS_BASE` no longer spoils a task cut from somewhere else. It still works as a personal default, and `--base` still forces a branch for one command (`reins resume` accepts it too now).
- **A mistyped base is no longer skipped silently.** A `REINS_BASE` or `base:` that names a branch that does not exist gives a warning in every command, instead of quietly comparing with `main`.

## 0.15.0 · 2026-11-10

The pull request map tells back end from front end, and a fix for the task level.

```bash
npx reins update
```

- **The pull request map shows each language in its own frame.** In a plan with several adapters (`adapters: [rails, js]`), the map draws one frame per language, and an arrow from one frame to the other is a dependency that crosses languages: a Rails controller that renders a React page. A domain with code on both sides is one box in each frame, and the text names the side: `accounts (rails) now uses billing (js)`. Repos with one adapter get the same map as before.
- **Fix: `reins triage` measured only the first file when the files were separated by spaces.** With `reins triage "<reason>" --files a b c`, only `a` was measured and `b c` ended up in the reason, so the level came out too low (0.14.0). Now every file after a quoted reason is measured; commas already worked.

## 0.14.0 · 2026-11-10

Ruby on Rails, and a task level that reins measures instead of the agent guessing it.

```bash
npx reins update
```

`update` also runs `sync`, which brings the new triage instruction: commit what it changed (`.reins/core/`, `AGENTS.md`). Nothing else to do in a JavaScript or TypeScript repo. For a Rails app, install `@agentreins/adapter-rails` and run `npx reins init`.

- **reins measures the task level; the agent no longer guesses it.** The agent runs `reins triage "<reason>" --files <paths it expects to touch>` and reins states the level from those files (domains, public APIs, `architecture.yml`, number of code files). The agent gives a level only to raise it, and reins keeps the higher of the two; when the level is large, it tells the agent to present the plan and wait. Below large, `--files` is required: `reins triage small "…"` alone is now refused with the fix (`npx reins update` brings the new instructions). `--override` records the level the person chose with `[quick]` or `[deep]`. Docs and tests no longer count toward the level (`triage.not_counted` in `.reins/doctor.yml`): a one-line fix with its test and its changelog entry is small again. And `reins triage` and every `reins progress` edit now say, while the work is in progress, that the task outgrew its level; before, only `reins doctor` did, at the end.
- **Looking at a task no longer takes it.** `reins progress show --task <name>` only reads; a session becomes the task's owner with its first edit (`done`, `add`, `next`…). Before, an agent that checked what another session had done silently took its task.
- **Ruby on Rails adapter: `@agentreins/adapter-rails`.** `reins check`, `init` and `impact` now work on a Rails app. Ruby has no imports, so the adapter reads which constants each file names (parsed with Prism; Ruby does not need to be installed), plus `require_relative` and associations. With Inertia, a controller is linked to the React, Vue or Svelte page it renders: use `adapters: [js, rails]` to cover both halves with one plan. `reins init` in a Rails app drafts `adapters: [rails]` with the new `rails` preset. Experimental: [what it reads and what it can't see](packages/adapters/rails/README.md).
- **`init` drafts one plan for several languages.** In a Rails app with a Vite frontend (Inertia) and both adapters installed, `reins init` writes `adapters: [rails, js]`, with the Ruby layers above the pages they render. The JS adapter has a new preset for that frontend, `inertia-react` (code in `app/frontend` or `app/javascript`), picked automatically.
- **`init` no longer knows any language.** What counts as source, as a test or as a folder's index file, how route folders are named (`(group)`, `[param]`) and where the code lives (`src/`) now come from each adapter's preset, so a new language needs no change in the CLI. Nothing changes for JavaScript and TypeScript repos: the draft is identical. Update the CLI and the adapters together (`npx reins update` does).
- **Team guide** ([docs/team-guide.md](docs/team-guide.md)). For everyone working in a repo that uses reins: the plan, notes, a task from start to PR, the reviewer, closing a task, the backlog and what to ask your agent. Paste it as the description of your adoption PR. The README points to it, and its common changes moved there.
- **A setup table you can read at a glance** in the README and on npm, plus the common changes on npm.

## 0.13.0 · 2026-11-09

`init` finds the modules of repos whose routes are thin, and new domains get their notes.

```bash
npx reins update
```

Already ran `init` on a repo with thin routes (`routes/x/index.jsx` and the code in `components/pages/x`)? Ask your agent to run `/reins-arch`: it proposes the missing domains and drafts their notes. `reins doctor` lists the domains still without a note.

- **`init` finds the modules of repos with thin routes.** A route folder with a single file (`routes/dashboard/index.jsx`) is now a domain when its code lives elsewhere, such as `components/pages/dashboard/`. Before, those routes were left out and their modules got no domain and no note. Several one-file routes built on one feature folder only they use (`notifications` and `notificationsPreferences` over `components/pages/notifications/`) become one domain. Re-run `reins init` in a copy, or ask `/reins-arch` to add the missing domains.
- **Setup names the agent steps.** The README, the `init` output, the report and the `install` hint now list reviewing the plan (`/reins-arch`) and filling in the notes (`/reins-notes`) as numbered steps between `init` and the first commit, and say to commit only once `reins check` passes.
- **New domains get their notes.** `reins doctor` now warns about every domain without a note when `architecture.yml` changed, not only when its code changed. `/reins-arch` drafts the notes of the domains it adds, and proposes grouping the one-file routes `init` left out when they are one flow (sign in, reset password… → `auth`).

## 0.12.0 · 2026-11-09

One plan can now cover a repo with several languages.

```bash
npx reins update
```

`update` also runs `sync`, which changes one line of your `.reins/architecture.yml`: commit it with the rest.

- **One plan for a repo with several languages.** `architecture.yml` now lists its adapters: `adapters: [js]`, and `adapters: [js, rust]` for a repo with JavaScript and Rust. Every adapter builds its part of the graph, and `check`, `impact`, `scope`, notes and the PR map see them together, with one baseline. `reins update` rewrites `adapter: js` as `adapters: [js]` for you: commit that one-line change with the rest. If you upgrade another way (Dependabot, `npm update`), `reins check` stops with the same fix. Only the JavaScript adapter exists today; this is what makes room for the next ones.

## 0.11.0 · 2026-11-09

Closing a task now makes sure what the agent learned is kept.

```bash
npx reins update
```

`update` also runs `sync`, which brings the new `done` skill and progress policy: commit what it changed (`.reins/core/`, `.claude/`).

- **Closing a task can't skip the wrap-up anymore.** When you say a task is done, the agent closes it with `reins progress close`, and reins now refuses until the notebook has nothing pending (each item done, or dropped with a reason) and the notes of the modules the task touched are updated. Before, an agent could close straight away and what it learned was lost when the notebook was cleaned up a week later. If a note really needs nothing (a version bump, say), the agent says why with `--notes-ok "<why>"`, and the reason stays in the notebook.

## 0.10.0 · 2026-11-09

Every pull request gets a map of how it changes your architecture.

```bash
npx reins update
```

- **Architecture map on pull requests** (experimental). On every PR, the reins job posts one comment and edits it on each push: which domains the PR touches, new and removed dependencies between them, dependencies that break a rule, two domains that now use each other, and folders that `architecture.yml` doesn't cover. It reads as a short list ("billing now uses notifications") with a map under it, so a reviewer sees the shape of the change before opening a file. A PR that changes no structure gets one line. Nothing to learn: it shows up by itself.
- **Turning it on in a repo you already have:** `update` never rewrites your workflow, so ask your agent to add the "Architecture map comment" step from the reins workflow template to `.github/workflows/reins.yml` (the README shows it). New installs get it already.
- **Turning it off:** add the label `reins:no-map` to one PR, or delete the step to turn it off for the repo.
- You can see the same comment locally: ask your agent for the architecture map of the branch (`npx reins review --map`).
- `install` adds `.reins/tmp/` to `.gitignore` (the map builds the base version of the code there and removes it when done).

## 0.9.0 · 2026-11-08

Several tasks and sessions on one branch, each task checked against its own changes, and reins in Cursor.

```bash
npx reins update
```

Then commit what it changed (`AGENTS.md`, `.reins/core/`, `.claude/`, and the new `.cursor/hooks.json`).

- **Cursor works with reins' hooks.** Cursor runs the hooks `reins sync` writes for Claude Code, so module notes, the task notebook and the impact warning reach Cursor's agent too, and `reins progress` recognizes the Cursor session. `sync` also writes a small `.cursor/hooks.json` (commit it): without it Cursor never runs the session start hook.
- **Agents no longer skip `reins impact` silently** (Claude Code). When the agent opens a file other code imports and the change would need a higher task level than the one it declared, reins tells it right then to stop, tell you and re-plan. The map behind it is built in the background when the session starts, so nothing gets slower.
- **Several tasks on one branch.** Each task now has its own notebook, `.reins/progress/<branch>/<task>/notebook.md`, so you can run tasks one after another on `main`, or open several sessions on the same feature ("you do the CSS, you the JS"). A new session no longer receives the previous task's notebook as if it were its own: it sees one line per open task and continues one, or starts its own. Notebooks clean themselves up: a closed task goes a week after closing, and an open one only when its branch is gone. Your current `<branch>.md` notebook keeps working until you close it.
- Agents record the task level with `npx reins triage <level> "<reason>"`, which also notes the commit the task starts from. `reins doctor` then checks **this task's** changes against its level, so on `main` or a long-lived branch an old `large` line no longer hides a bigger task, and an old line no longer makes new work look declared. `reins resume` lists the task's files and removes, by itself, the log lines of deleted branches and of tasks already merged. Old lines without a commit keep working as before.
- `reins update` says which version it installed (`0.8.0 -> 0.8.1`), or that it is still on the same one and why: pnpm 11 waits a day before installing new releases (`minimumReleaseAge`) and reports nothing.
- When `sync` overwrites a file you edited by hand, it tells you where your change belongs (for example `copy it to .reins/skills/audit/SKILL.md`) instead of pointing to a template inside the reins package.
- Module notes are no longer delivered twice when the agent reads several files at once, and the record of which notes each session received no longer gets corrupted (which made every session receive its notes again).

## 0.8.1 · 2026-11-07

Your own skills, agents and policies have a visible home again.

```bash
npx reins update
```

- `sync` writes a short `README.md` into `.reins/skills/`, `.reins/agents/`, `.reins/policies/` and `.reins/review/`: what goes in each folder and which reins defaults you can override (skills, agents, the review checklist; not reins' policies or notebook templates, which `doctor` and `reins progress` rely on). In 0.8.0 the migration removed the old copies and left no trace of where your own files go.
- The rules block in `AGENTS.md` now points agents to the team's skills and agents in `.reins/skills/` and `.reins/agents/`, not only to the ones in `.reins/core/`.

## 0.8.0 · 2026-11-07

reins works the same with any coding agent, and updates itself.

**Coming from 0.7 or earlier** (`reins update` does not exist yet in your version):

```bash
npm i -D @agentreins/cli@latest @agentreins/adapter-js@latest   # or pnpm add -D / yarn add -D
npx reins sync
```

`sync` migrates the repo: it creates `.reins/core/`, removes the copies an older `install` put in `.reins/` that nobody edited, and moves the rules an older reins wrote in `AGENTS.md` into the managed rules block. Then check three things by hand:

- `.reins/doctor.yml` says `agents_md: { max_lines: 30 }`: change it to `45`, or delete the line to use the new default.
- Your `AGENTS.md` was your own and never had the reins rules: run `npx reins install` once to append the rules block (everything else is kept).
- You edited the reins rules in `AGENTS.md`: `sync` warns and leaves them. Put `<!-- reins:rules:start -->` and `<!-- reins:rules:end -->` where they go, move your own lines outside, and run `npx reins sync`.

From now on, `npx reins update` does it all: it updates the CLI and installed adapters with your package manager, then runs the new `reins sync`.

- **Provider-neutral core.** Policies, skills, agents, notebook templates and the review checklist now ship in `.reins/core/`, refreshed by every `sync`. Your own versions in `.reins/skills/`, `.reins/agents/`, `.reins/templates/` and `.reins/review/checklist.md` still win.
- **Rules block in `AGENTS.md`.** The reins rules live between `reins:rules` markers and are updated by `sync`, so new rules reach every repo. They now also point any agent to the skills and agents in `.reins/core/`.
- **Claude Code is optional.** `install`, `sync` and `update` accept `--skip-claude` (and `--claude` to turn it back on); the choice is saved so CI checks the same thing. Claude Code stays on by default.
- **`reins update`** (new, experimental). Uses pnpm, yarn, bun or npm, whichever the repo uses; adds `-w` at a pnpm workspace root.
- **`AGENTS.md` limit is 45 lines** (was 30), so the rules block fits next to your own rules and the notes index.
- `install` no longer copies policies, skills and agents into `.reins/`; it adds the rules block to an existing `AGENTS.md` above its notes, and never twice.

## 0.7.4 · 2026-11-07

Make architecture impact guidance easier for agents to find and follow.

After updating, compare the installed `.reins` templates and merge the changes you want. `install` does not overwrite existing files:

```bash
diff -ru node_modules/@agentreins/cli/templates/.reins .reins
diff -u node_modules/@agentreins/cli/templates/AGENTS.md AGENTS.md
```

- Generated `AGENTS.md` now explains when to run `reins impact`, how to use `scope` and `review`, and where to find command help.
- Triage policy clarifies that `scope` and `impact` are allowed for small tasks, and requires impact analysis before domain-level work or changes to shared files.
- Explorer and audit guidance now uses impact results to identify affected domains and make findings more actionable.

## 0.7.2 · 2026-11-06

Impact questions answered before the refactor, not after.

After updating the packages, the triage policy has a new paragraph (before changing a file other domains may import, run `reins impact`). `install` copies policies only when they are missing, so yours stays as it is: `diff -u .reins/policies/triage.md node_modules/@agentreins/cli/templates/.reins/policies/triage.md` and add it by hand (or copy the file if you never edited it). Commit `.reins/policies/triage.md`.

- `reins impact <file-or-folder>`: the reverse of `scope`. From the real import graph joined with your plan: the domains that consume a file, the imports that bypass a domain's public API, the violations that already involve it, the notes to read, and the minimum task level if the change breaks its importers (same thresholds as `scope`). Importers behind a re-export barrel count as consumers of the real file. Every import kind counts, including type-only. `--json`.
- Triage policy: the mid-task escalation "a second domain appeared while editing" gets resolved at announcement time; the policy says when to run `impact`.
- The npm READMEs of the three packages are rewritten and up to date (`impact`, the complete command list, the contract with `presets`/`uses`, adapter barrels and monorepo support).

## 0.7.1 · 2026-11-06

Fewer false triage warnings, and no triage for plain questions.

After updating the packages, bring the triage policy up to date. `install` copies policies only when they are missing, so yours stays as it is: `diff -u .reins/policies/triage.md node_modules/@agentreins/cli/templates/.reins/policies/triage.md` and add the new paragraph by hand (or copy the file if you never edited it). Commit `.reins/policies/triage.md`.

- `reins doctor` (`triage-mismatch`): the branch diff is compared with the highest level declared on the branch, not with its latest `triage.log` line. A small or read-only task after a large one no longer makes the large diff look undeclared. The warning cites the line that set that level; on ties, the most recent one.
- Triage policy: information-only messages (a question answered from the conversation, a confirmation of the workflow) are not tasks: no level, no announcement, no `triage.log` line. A question that needs repository work, such as a review or an investigation, is still triaged even if no file changes.

## 0.7.0 · 2026-11-05

Catching module notes that no longer match the code.

After updating the packages:

1. The `notes` and `done` skills changed. If you never edited them: `rm -rf .reins/skills/notes .reins/skills/done` and `npx reins install` (it copies only what is missing). If you did, merge by hand: `diff -ru node_modules/@agentreins/cli/templates/.reins/skills .reins/skills`.
2. `npx reins sync`, then `npx reins doctor` and `npx reins notes stale`.
3. If doctor reports `note-dead-paths`/`note-dead-refs`, or `stale` lists notes far behind: in Claude Code, `/reins-notes review` (it costs tokens; ask for a few notes at a time if there are many).
4. Commit `.reins/skills/`, `.claude/`, `.reins/.generated.json` and any note that changed.

From a version before 0.6.2, also delete the `- Before touching these paths, read their note:` line above the notes block in `AGENTS.md`.

- `reins doctor`, for every note (not only the ones the branch touched), warn only:
  - `note-dead-paths`: a glob in a note's `paths` matches no file. A module that was moved or renamed leaves its note reaching nobody, silently.
  - `note-dead-refs`: a note names, in backticks, a repo file or folder that no longer exists. Only paths whose first folder exists at the repo root are checked.
  - Several notes with the same problem make one warning.
- `reins notes stale`: notes ranked by commits to their paths since the note last changed, from git history. A signal, not proof. `--limit <n>`, `--json`.
- `/reins-notes review`: the agent checks the notes named, or the top of `reins notes stale`, against the code and fixes what is no longer true. It costs tokens, so it only runs when asked.

## 0.6.2 · 2026-11-05

Run `reins sync` after updating.

- `AGENTS.md` notes block: its first line now says to run `npx reins notes <path…>` before changing a file. The notes hook only fires on Read/Edit/Write, so an agent reading code through the shell (`cat`, `grep`, `sed`) or another tool (a code-graph MCP server) never got the notes. When the path → note index does not fit in the `AGENTS.md` limit, the block keeps that line and the number of notes, instead of the module names of 0.6.1, which did not match paths to notes nor list the parts of a module.
- New installs: the `- Before touching these paths, read their note:` line above the block is gone, since the block now says it. In an existing `AGENTS.md` that line belongs to you: you can delete it.

## 0.6.1 · 2026-11-05

Fixes found running 0.6.0 on a real Next.js app. Run `reins sync` after updating.

- Fix: `reins sync` no longer writes an `AGENTS.md` that `reins doctor` rejects. The notes index fits in doctor's `agents_md.max_lines` (30 by default, set in `.reins/doctor.yml`) minus the hand-written lines; when one line per note does not fit, the index becomes a single line naming the modules. The notes hook still delivers every note when its paths are touched. If the hand-written part alone is over the limit, `sync` says so.
- `reins doctor`: draft notes make one `note-draft` warning for all of them (count and the first names), instead of one per note. Drafts are templates waiting to be filled in, not problems in the code.

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
