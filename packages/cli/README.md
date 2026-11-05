# reins

**Hold the reins of your coding agents: they respect your architecture and remember your project.**

Coding agents write code fast, but they forget your architecture (a shared component imports from a feature, an import cycle appears) and they forget your project (every session re-reads a module to work out what it does and why).

reins fixes both:

- **Your architecture becomes a check.** It runs on every commit and every pull request, whatever agent wrote the code. A broken rule blocks the commit with the reason and the fix, so the agent corrects it before you review.
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

```bash
npx reins install                  # git hook, CI job, AGENTS.md, .claude/
npx reins init                     # architecture plan, baseline, module notes
npx reins check --update-baseline  # freeze today's violations
npx reins check                    # from now on, only new violations fail
```

Between `init` and `check --update-baseline`:

1. **Review the architecture plan.** In Claude Code, type `/reins-arch`: your agent proposes changes with evidence and you approve each one. Otherwise read `.reins/init-report.md` and edit `.reins/architecture.yml`.
2. **Fill in the module notes.** In Claude Code, type `/reins-notes`; with other agents, ask *"fill in the TODO lines of the notes in .reins/notes/"*.

Then commit everything. Nothing is overwritten: `install` and `init` only add files or ask first (`--dry-run` shows what they would do).

## What you get

**A plan in `.reins/architecture.yml`**, drafted by `init` from your code and checked on every commit:

```yaml
version: 1
adapter: js
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

**Module notes** in `.reins/notes/`: one per module, drafted from the import graph and filled in by your agent. A big module keeps the notes of its parts in a folder (`companies.md` + `companies/salaries.md`); an agent working in `salaries/` reads both, general first.

## Commands

| Command | What it does |
| --- | --- |
| `reins install` | Wires reins into the repo: `.reins/` sources, pre-commit hook (Husky or lefthook), CI workflow, `.gitignore`, `AGENTS.md`, `.claude/` |
| `reins init` | Drafts `architecture.yml`, the baseline, a review report and the module notes from the code |
| `reins check` | Checks the rules (git hook and CI). `--update-baseline`, `--coverage`, `--json`, `--files` |
| `reins notes <path>` | Prints the module notes for a path. `reins notes new <domain\|folder>` drafts one |
| `reins sync` | Regenerates `.claude/` and the notes index in `AGENTS.md` from `.reins/` |
| `reins doctor` | Local workflow checks: task level, notebook, module notes, `AGENTS.md` size |
| `reins scope <paths>` | Domains, notes and minimum task level for some paths |
| `reins resume` | Notebook, changed files and notes to resume a task (also a Claude Code hook) |
| `reins audit`, `reins progress`, `reins review` | Local backlog, branch notebook, review prompt |

`reins <command> --help` explains each one. Every command except `check` and `init` is still experimental.

## Skills for your agent

`reins install` adds these skills. In Claude Code, type them or ask in your own words; other agents read the same instructions in `.reins/skills/<name>/SKILL.md`.

| Skill | What your agent does |
| --- | --- |
| `/reins-done` | Closes a task: runs the checks once, updates the notebook and the notes of the modules it touched |
| `/reins-notes` | Fills in module notes from the code; never invents a decision, leaves questions for you |
| `/reins-arch` | Reviews `architecture.yml` against the code and proposes changes; applies nothing until you approve |
| `/reins-audit` | Looks for improvements and adds only new findings to the backlog |
| `/reins-backlog` | Shows what is pending and proposes what to do next |
| `/reins-agent` | Creates a new subagent in `.reins/agents/` |

## Learn more

- [Full documentation](https://github.com/fredarcito/reins#readme): how it works, diagrams, every option
- [Walkthrough with real output](https://github.com/fredarcito/reins/blob/main/docs/walkthrough.md)
- [Try it on a branch first](https://github.com/fredarcito/reins/blob/main/docs/try-it.md)
- [`architecture.yml` reference](https://github.com/fredarcito/reins/blob/main/docs/architecture-yml.md)
- [Changelog](https://github.com/fredarcito/reins/blob/main/CHANGELOG.md) · [Issues](https://github.com/fredarcito/reins/issues)

## License

MIT
