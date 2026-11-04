# templates

Files that end up in a consumer repo, laid out as they will be there. `reins install` (phase 8) copies them;
`reins sync` creates `AGENTS.md`/`CLAUDE.md` from here when they are missing and generates `.claude/` from `.reins/`.
They ship inside `reins` (copied at pack time).

| File | What it is | Read by the agent |
| --- | --- | --- |
| `AGENTS.md` | ≤ 30-line map: commands, golden rules, notes index. `{{project}}` and `{{commands}}` come from `package.json` | Always |
| `CLAUDE.md` | `@AGENTS.md` | Always (Claude Code) |
| `.reins/policies/triage.md` | Task levels, overrides, escalation, `triage.log` | When announcing a level |
| `.reins/policies/progress.md` | Notebook rules and verification | Medium and large tasks |
| `.reins/policies/multiagent.md` | Leader, implementers, reviewer; one report file per agent | Large tasks with subagents |
| `.reins/templates/progress-*.md` | Notebook templates: mini (medium), hot + cold folder (large). Adapt them to your team; `reins progress new` uses them | When starting a notebook |
| `.reins/review/checklist.md` | Short review checklist | Reviewer agent, `reins review` |
| `.reins/notes/_template.md` | Shape of a module note (files starting with `_` are not notes) | — |
| `.reins/skills/{audit,backlog,done,notes,arch,agent}/` | Skill sources → `.claude/skills/reins-*` | On demand, by description, or by name (`/reins-notes`) |
| `.reins/agents/{reviewer,explorer}.md` | Read-only agent sources → `.claude/agents/reins-*` | When delegated |
| `.reins/hooks/pre-commit.sh` | `reins check --files <staged files>` | Git, not the agent |
| `.reins/doctor.yml` | Doctor thresholds | `reins doctor` |

Everything here is **experimental**: it is text the agent may ignore. Only `reins check` is enforced.
