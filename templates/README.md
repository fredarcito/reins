# templates

Files that end up in a consumer repo, laid out as they will be there.
`reins install` copies the root and user-owned templates; `reins sync` manages `.reins/core/`
and the shared `AGENTS.md` blocks, and optionally generates the Claude Code adapter.
They ship inside `reins` (copied at pack time).

| File | What it is | Read by the agent |
| --- | --- | --- |
| `AGENTS.md` | ≤ 45-line map: commands, reins rules block, notes index. `{{project}}` and `{{commands}}` come from `package.json` | Always |
| `CLAUDE.md` | `@AGENTS.md` | Optional Claude Code adapter |
| `.reins/core/rules.md` | Core reins rules synced into `AGENTS.md` | Through `AGENTS.md` |
| `.reins/core/policies/triage.md` | Task levels, overrides, escalation, `triage.log` | When announcing a level |
| `.reins/core/policies/progress.md` | Notebook rules and verification | Medium and large tasks |
| `.reins/core/policies/multiagent.md` | Leader, implementers, reviewer; one report file per agent | Large tasks with subagents |
| `.reins/core/templates/progress-*.md` | Notebook templates: mini (medium), hot + cold folder (large). Overridable in `.reins/templates/` | When starting a notebook |
| `.reins/core/review/checklist.md` | Short review checklist. Overridable in `.reins/review/checklist.md` | Reviewer agent, `reins review` |
| `.reins/core/skills/{audit,backlog,done,notes,arch,agent}/` | Provider-neutral Markdown skill sources; optional Claude Code wrappers → `.claude/skills/reins-*` | On demand or when following `AGENTS.md` |
| `.reins/core/agents/{reviewer,explorer}.md` | Provider-neutral agent definitions; optional Claude Code wrappers → `.claude/agents/reins-*` | When delegated |
| `.reins/{skills,agents,policies,review}/README.md` | Where the team's own skills, agents, policies and review checklist go, and which reins defaults can be overridden. Written by `reins sync` | When adding your own |
| `.reins/notes/_template.md` | Shape of a module note (files starting with `_` are not notes) | — |
| `.reins/hooks/pre-commit.sh` | `reins check --files <staged files>` | Git, not the agent |
| `.reins/doctor.yml` | Doctor thresholds | `reins doctor` |

Everything here is **experimental**: it is text the agent may ignore. The Markdown and CLI are provider-neutral; generated hooks and native skill discovery depend on the client. Only `reins check` is enforced.
