# reins

**reins is an engineering harness for AI coding agents.** It makes project knowledge persistent, architecture enforceable, and development workflows consistent across models, agents, and sessions.

Hold the reins of your coding agents: they respect your architecture and remember your project. reins is not a framework for building agents: it shapes how the agents you already use (Claude Code, Codex, Cursor or any other) work on your codebase.

Project site: **[fredarcito.github.io/reins](https://fredarcito.github.io/reins/)**

Coding agents write code fast, but they forget your architecture (a shared component imports from a feature, an import cycle appears) and they forget your project (every session re-reads a module to work out what it does and why).

reins fixes both:

- **Your architecture becomes a check.** It runs on every commit and every pull request, whatever agent wrote the code. A broken rule blocks the commit with the reason and the fix, so the agent corrects it before you review. On every pull request it also posts one comment that shows how the change moves your architecture: new dependencies between domains, new domains, rules broken. And before the edit, `reins impact` tells the agent which domains consume a shared file, so a "small fix" that is really a large refactor says so before the work starts.
- **Each module gets a short note**: what it does, how it works, the decisions taken and why, its traps. The note reaches the agent as soon as it opens a file of that module, and after a compaction the task's notebook comes back on its own.

Made for frontend teams on **Vite + React** or **Next** (app and pages router, plain JS/JSX or TypeScript) working with Claude Code, Codex, Cursor or any other agent. A Node CLI and plain markdown: no service, no API keys, no telemetry.

## Requirements

- Node.js 22 or newer
- A git repository
- TypeScript projects: the `typescript` package already installed in the project

## Install

```bash
npm install -D @agentreins/cli @agentreins/adapter-js
# pnpm add -D @agentreins/cli @agentreins/adapter-js
# yarn add -D @agentreins/cli @agentreins/adapter-js
```

`@agentreins/cli` is the `reins` command; `@agentreins/adapter-js` teaches it to read JavaScript/TypeScript imports.

## Quick start

In the root of your project:

| Step | You do | What you get |
| --- | --- | --- |
| 1 · Install | `npm install -D @agentreins/cli @agentreins/adapter-js` | The CLI and the JavaScript/TypeScript adapter |
| 2 · Wire | `npx reins install` | Git hook, CI job, `AGENTS.md`, `.reins/` |
| 3 · Draft | `npx reins init` | Architecture plan, baseline, one note per domain |
| 4 · Review the plan | `/reins-arch` | Your agent proposes changes; you approve each one |
| 5 · Fill in the notes | `/reins-notes` | Each module explained for the next session |
| 6 · Freeze | `npx reins check --update-baseline`, then `npx reins check` | Today's violations frozen; only new ones fail |
| 7 · Commit | `git commit` | Only now: the pre-commit hook needs the plan |

- Steps 4 and 5 are done by your agent; don't skip them. The draft only describes what exists, and the notes start as templates.
- `/reins-arch` and `/reins-notes` are Claude Code commands. With other agents, ask: *"review .reins/init-report.md and propose changes to .reins/architecture.yml"*, then *"fill in the TODO lines of the notes in .reins/notes/"*.
- For a provider-neutral setup, use `npx reins install --skip-claude`.

Nothing is overwritten: `install` and `init` only add files or ask first (`--dry-run` shows what they would do).

## Common changes

After setup, you ask your agent and it runs the commands. What to ask:

| You want to | Ask your agent | What it does |
| --- | --- | --- |
| Add a domain | *"add a domain `auth` with src/routes/signIn and src/routes/resetPassword"*, or `/reins-arch` | Adds it to `architecture.yml`, freezes what it reveals (if you agree), drafts and fills in its note |
| Change what a domain covers | *"move src/components/pages/x into the domain `y`"* | Edits its `paths`, freezes what it reveals, updates the notes of the domains involved |
| Remove a domain | *"remove the domain `x` and its note"* | Removes it from `architecture.yml`, updates the baseline, deletes the note |
| Add a note without a domain | *"create a note for the login flow, covering src/routes/signIn and src/api/auth.js"* | `reins notes new … --name login --paths …`, fills it in |
| Remove a note | *"delete the note `x`"* | Deletes `.reins/notes/x.md` (and `.reins/notes/x/` with its parts), then `reins sync` |
| Refresh notes behind their code | `/reins-notes review` | Finds the notes most behind their code and updates them |

- A changed `architecture.yml` shows an `integrity` warning in the pull request. That is expected: explain the change in the PR description.
- `reins doctor` warns about a domain without a note, so a new domain doesn't stay undocumented.
- Edited a note, skill or agent by hand? `npx reins sync` puts it in `AGENTS.md` and `.claude/`.

## What you get

**A plan in `.reins/architecture.yml`**, drafted by `init` from your code and checked on every commit:

```yaml
version: 1
adapters: [js]
preset: next-app

layers:               # top to bottom: a layer only imports from itself and the layers below
  - { name: app,        paths: ["src/app/**"] }
  - { name: features,   paths: ["src/features/**"] }
  - { name: components, paths: ["src/components/**"] }
  - { name: shared,     paths: ["src/lib/**", "src/hooks/**"] }

domains:              # code outside a domain only imports its public API
  billing: { paths: ["src/features/billing/**"], public_api: ["src/features/billing/index.js"] }
```

**Findings an agent can fix alone**, as text or `--json`:

```
✖ error layer-direction  src/components/PriceTag.js → src/features/billing/index.js
    Why: src/components/PriceTag.js (components) imports src/features/billing/index.js (features), but features is above components.
    Fix: Move what src/components/PriceTag.js needs from features down to components or a lower layer, or invert the dependency (pass it in as props or callbacks).

reins check: 1 new (1 error, 0 warnings) · 3 in baseline · 0 fixed
Result: FAIL (new errors)
```

**A baseline**: today's violations are frozen in `.reins/baseline.json`, so you start green and only *new* problems fail. The baseline can only shrink.

**The blast radius before a refactor.** `reins impact <file-or-folder>` joins the real import graph with your plan and answers the question an agent has before touching a shared file: *who else imports this?*

```
$ npx reins impact src/lib/date.ts
File: src/lib/date.ts (no domain)
Imported by: 2 files — billing (1), no domain (1)
Public API: no
Boundary crossings: none
Existing violations: 1 (no-cycles new; run `reins check --files src/lib/date.ts` to see them)
Notes to read: .reins/notes/lib.md
Minimum level (if the change breaks importers): small (3 file(s) in 1 domain)
```

A boundary crossing is an import that reaches a domain's internals instead of its public API — the same leak `domain-boundary` reports, seen before you edit. Every import kind counts, including type-only imports: a type change breaks them too. Symbol-level questions ("who calls `formatDate` inside billing?") stay with grep, run inside the domains `impact` lists.

**Module notes** in `.reins/notes/`: one per module, drafted from the import graph and filled in by your agent. A big module keeps the notes of its parts in a folder (`companies.md` + `companies/salaries.md`); an agent working in `salaries/` reads both, general first. `reins notes stale` ranks notes that fell behind the code.

## The agent's workflow

What `install` sets up, in the order the agent hits it:

1. **Announce.** Every task gets a level — `small`, `medium`, `large` — from the triage policy in `.reins/core/policies/`. `reins scope <paths>` gives the objective signals: domains touched, notes to read, minimum level.
2. **Plan.** Before changing a file other domains may import (a util, a type, a barrel, a public API), the agent runs `reins impact` on it. "Medium, but could be large if another domain shows up" stops being a guess.
3. **Edit.** The module note arrives the moment the agent opens a file — a Claude Code hook, or the notes index in `AGENTS.md` for any other agent.
4. **Close.** `reins check` confirms the boundaries instead of surprising; `reins doctor` (local, never in CI) compares the declared level with the branch diff and flags stale or missing notes. `reins progress close` only closes the task once nothing in its notebook is pending and those notes are updated, so what the agent learned stays.

## Commands

| Command | What it does |
| --- | --- |
| `reins install` | Wires reins into the repo: pre-commit hook (Husky or lefthook), CI workflow, `.gitignore`, the reins rules and notes blocks in `AGENTS.md`, then `sync`. `--dry-run`, `--skip-claude` |
| `reins init` | Drafts `architecture.yml`, the baseline, a review report and the module notes from the code. `--dry-run`, `--preset <name>` |
| `reins check` | Checks the rules (git hook and CI). `--update-baseline`, `--coverage`, `--json`, `--files` |
| `reins scope <paths>` | Domains, public APIs, notes to read and the minimum task level for some paths. `--json` |
| `reins impact <file-or-folder>` | The reverse of `scope`: the domains that consume a file, imports that bypass a public API, violations that already involve it, and the minimum level if the change breaks its importers. `--json` |
| `reins notes <path...>` | Prints the module notes for a path (`--hook`: the Claude Code fast path). `notes new <domain\|folder>` drafts one from the import graph; `notes stale` ranks notes behind the code. `--json` |
| `reins resume` | Notebook, changed files and notes to resume a task. `--json`, `--hook` (Claude Code `SessionStart`) |
| `reins sync` | Refreshes `.reins/core/` (rules, policies, skills, agents), the rules and notes blocks in `AGENTS.md`, and the optional Claude Code files. `--check`, `--skip-claude`, `--claude` |
| `reins update` | Updates the CLI and installed adapters with your package manager, then runs the new `reins sync`. `--dry-run`, `--skip-claude`, `--claude` |
| `reins doctor` | Local workflow checks: declared task level vs the branch diff, the notebook, the notes, `AGENTS.md` size. Warns, never blocks, never in CI |
| `reins audit`, `reins progress`, `reins review` | Local backlog of findings; one notebook per task (`close` refuses while something is pending or a touched module's note is behind); review prompt, and `review --map` prints the pull request architecture map |

`reins <command> --help` explains each one. Every command except `check` and `init` is still experimental.

## Skills for your agent

`reins sync` keeps these skills in `.reins/core/skills/` (your own versions in `.reins/skills/` win). In Claude Code, type them or ask in your own words; other agents find them through `AGENTS.md`.

| Skill | What your agent does |
| --- | --- |
| `/reins-done` | Closes a task: runs the checks once, updates the notebook and the notes of the modules it touched |
| `/reins-notes` | Fills in module notes from the code; never invents a decision, leaves questions for you |
| `/reins-arch` | Reviews `architecture.yml` against the code and proposes changes; applies nothing until you approve |
| `/reins-audit` | Looks for improvements and adds only new findings to the backlog |
| `/reins-backlog` | Shows what is pending and proposes what to do next |
| `/reins-agent` | Creates a new agent definition in `.reins/agents/` |

## Updating

```bash
npx reins update   # from 0.8.0 on: updates the packages, then runs reins sync
```

Coming from 0.7 or earlier, `update` does not exist yet: update the packages yourself (`npm i -D @agentreins/cli@latest @agentreins/adapter-js@latest`), then run `npx reins sync` once.

Read the [changelog](https://github.com/fredarcito/reins/blob/main/CHANGELOG.md) of each version you skipped: it says when something else is worth doing.

## Learn more

- [Project site](https://fredarcito.github.io/reins/)
- [Full documentation](https://github.com/fredarcito/reins#readme): how it works, diagrams, every option
- [Walkthrough with real output](https://github.com/fredarcito/reins/blob/main/docs/walkthrough.md)
- [Try it on a branch first](https://github.com/fredarcito/reins/blob/main/docs/try-it.md)
- [Adopting it as a team](https://github.com/fredarcito/reins/blob/main/docs/team-adoption.md)
- [`architecture.yml` reference](https://github.com/fredarcito/reins/blob/main/docs/architecture-yml.md)
- [Changelog](https://github.com/fredarcito/reins/blob/main/CHANGELOG.md) · [Issues](https://github.com/fredarcito/reins/issues)

## License

MIT
