# Triage policy

Every task gets a level before acting. You decide with your judgment and this policy; the person can change it.

A task is anything that needs reading the repo, running a command or changing a file. Information-only messages (a question you can answer from the conversation, a confirmation of the workflow) are not tasks: no level, no announcement, no `triage.log` line. A question whose answer needs repository work is a task: triage it.

| Level | Signal | What you do |
| --- | --- | --- |
| small | A named file or function; a bounded change | Read only that file and its note. Don't explore (`reins scope` and `reins impact` are not exploring). No notebook |
| medium | One domain, several files, no new architecture decisions | Read the module note first (purpose, map, how it works); search the code only for what it does not answer. Summarize in two lines before editing. Mini notebook |
| large | Several domains, a new feature, a refactor, a contract change, a migration, or "review everything" | Write done criteria, run `npx reins impact` on each folder or file the plan changes, use the explorer (read-only; hand it the impact output), present a plan and **wait for confirmation**. Full notebook |

## Rules

- **Explicit override (highest priority):** `[quick]` or `/quick` = small; `[deep]` or `/plan` = large. Don't announce the level then.
- **Announce:** one line with level and reason before acting. Small and medium continue without waiting; large presents the plan and waits.
- **Log it:** when announcing, run `npx reins triage <small|medium|large> "<reason>"`. It appends a line to `.reins/progress/triage.log` with the date, the branch and the commit the task starts from (HEAD). `reins doctor` compares the level with this task's diff: changes since that commit, plus uncommitted ones. Tasks started at the same commit share that diff, so the highest of their levels counts. `reins resume` removes the lines of deleted branches and of tasks whose commits are already in the base branch.
- **When in doubt:** pick the lower level and say so ("medium, but could be large if another domain shows up").
- **Objective signals:** `npx reins scope <paths>` prints the domains, notes and minimum level: 1 domain and ≤ 3 files = small; 1 domain and more files = medium; 2+ domains, a public API or `architecture.yml` = large. For a task about a whole domain or folder, pass the folder, not two of its files.
- **Impact — don't skip it:** run `npx reins impact <file-or-folder>`
  1. when the task restructures, refactors or optimizes a domain or folder: on that folder, while mapping, before the plan;
  2. before editing a file other code may import (a component, util, type, hook, barrel or public API). Unsure whether it's shared → run it: one call is cheaper than a wrong level.

  In Claude Code, opening a shared file whose minimum level is above the declared one (or with no level declared) brings a warning from reins: stop, tell the person, re-triage with `npx reins triage`, and for large present the plan before editing.

  Never conclude "nothing shared changes" without it. It prints the consuming domains, the imports that bypass a public API, the notes to read and the minimum level if the change breaks importers; it is not exploring, so it applies at every level. It sees imports, not HTTP calls: find callers of an API route with grep. For symbol-level questions, grep inside the domains it lists.
- **Escalate mid-task:** stop and propose a higher level if a second domain appears, the thresholds are exceeded, you need to change a public API, a rule or the baseline, or `reins check` fails for something unexpected. Run `npx reins triage <new level> "<reason>"` again. Don't escalate "just in case".
