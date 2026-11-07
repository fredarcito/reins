---
name: backlog
description: Show and manage the pending improvements in the local backlog (.reins/backlog/optimizations.md) — what is open, what to do next, add, close or drop an item. Use it when the person asks what is pending or left to do, what to work on next, or to add something to the backlog.
---
# Backlog

The backlog keeps improvements found along the way that are not part of the current task. It is local (`.reins/backlog/optimizations.md`, outside git). Change it only through `npx reins audit` commands, never by rewriting the file. Looking for new improvements in the code is `/reins-audit`, not this skill.

- **"What's pending?"** `npx reins audit list` (open items; `--status all` for history, `--recheck` for flagged ones). Reply grouped by area (path), with each id, and point out the items marked `[recheck]`. If there is a current task, mention its next step too (`npx reins progress show`).
- **"What should we do next?"** Propose one to three open items, each with why: impact, size, risk. Before recommending one, check it against the current code; if it is already fixed, close it: `npx reins audit set <id> done "<how>"`.
- **"Add X to the backlog."** Check it isn't there already (`npx reins audit list --status all`), then `npx reins audit add "<path>" "<finding and suggested fix>"`.
- **Working on an item.** It becomes a normal task: announce its level (`.reins/policies/triage.md`). When it is finished: `npx reins audit set <id> done "<how>"`.
- **Dropping an item.** `npx reins audit set <id> wontfix "<reason>"`. If the reason will hold over time, add it to the module note (`.reins/notes/`) so nobody proposes it again.
