# Triage policy

Every task gets a level before acting. You decide with your judgment and this policy; the person can change it.

A task is anything that needs reading the repo, running a command or changing a file. Information-only messages (a question you can answer from the conversation, a confirmation of the workflow) are not tasks: no level, no announcement, no `triage.log` line. A question whose answer needs repository work is a task: triage it.

| Level | Signal | What you do |
| --- | --- | --- |
| small | A named file or function; a bounded change | Read only that file and its note. Don't explore. No notebook |
| medium | One domain, several files, no new architecture decisions | Read the module note first (purpose, map, how it works); search the code only for what it does not answer. Summarize in two lines before editing. Mini notebook |
| large | Several domains, a new feature, a refactor, a contract change, a migration, or "review everything" | Write done criteria, use the explorer (read-only), present a plan and **wait for confirmation**. Full notebook |

## Rules

- **Explicit override (highest priority):** `[quick]` or `/quick` = small; `[deep]` or `/plan` = large. Don't announce the level then.
- **Announce:** one line with level and reason before acting. Small and medium continue without waiting; large presents the plan and waits.
- **Log it:** when announcing, append one line to `.reins/progress/triage.log`:
  `YYYY-MM-DD | <branch> | small|medium|large | <reason>`
  `reins doctor` compares it with the diff.
- **When in doubt:** pick the lower level and say so ("medium, but could be large if another domain shows up").
- **Objective signals:** `npx reins scope <paths>` prints the domains, notes and minimum level: 1 domain and ≤ 3 files = small; 1 domain and more files = medium; 2+ domains, a public API or `architecture.yml` = large.
- **Shared files:** before changing a file other domains may import (a util, a type, a barrel, a public API), run `npx reins impact <file-or-folder>`: the consuming domains, the imports that bypass a public API, and the minimum level if the change breaks importers. "Could be large if another domain shows up" stops being a guess; grep inside the listed domains for symbol-level questions.
- **Escalate mid-task:** stop and propose a higher level if a second domain appears, the thresholds are exceeded, you need to change a public API, a rule or the baseline, or `reins check` fails for something unexpected. Append a new line to `triage.log`. Don't escalate "just in case".
