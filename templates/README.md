# templates

Files that end up in a consumer repo, laid out as they will be there. `harness install` (phase 8) copies them;
`harness sync` creates `AGENTS.md`/`CLAUDE.md` from here when they are missing and generates `.claude/` from `.harness/`.
They ship inside `@harness/cli` (copied at pack time).

| File | What it is | Read by the agent |
| --- | --- | --- |
| `AGENTS.md` | ≤ 30-line map: commands, golden rules, notes index. `{{project}}` and `{{commands}}` come from `package.json` | Always |
| `CLAUDE.md` | `@AGENTS.md` | Always (Claude Code) |
| `.harness/policies/triage.md` | Task levels, overrides, escalation, `triage.log` | When announcing a level |
| `.harness/policies/progress.md` | Notebook rules and verification | Medium and large tasks |
| `.harness/policies/multiagent.md` | Leader, implementers, reviewer; one report file per agent | Large tasks with subagents |
| `.harness/templates/progress-*.md` | Notebook templates: mini (medium), hot + cold folder (large) | When starting a notebook |
| `.harness/review/checklist.md` | Short review checklist | Reviewer agent, `harness review` |
| `.harness/notes/_template.md` | Shape of a module note (files starting with `_` are not notes) | — |
| `.harness/skills/{audit,close-task}/` | Skill sources → `.claude/skills/harness-*` | On demand, by description |
| `.harness/agents/{reviewer,explorer}.md` | Read-only agent sources → `.claude/agents/harness-*` | When delegated |
| `.harness/hooks/pre-commit.sh` | `harness check --files <staged files>` | Git, not the agent |
| `.harness/doctor.yml` | Doctor thresholds | `harness doctor` |

Everything here is **experimental**: it is text the agent may ignore. Only `harness check` is enforced.
