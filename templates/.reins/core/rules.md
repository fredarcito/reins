## Always
- Before acting, state the task level (small, medium, large) and why in one line, and append it to `.reins/progress/triage.log`. See `.reins/core/policies/triage.md` (or `.reins/policies/triage.md`). A prompt starting with [quick] or [deep] decides the level; then don't announce it.
- Before restructuring a domain or folder, or editing a file other code may import (component, util, type, barrel, public API), run `npx reins impact <file-or-folder>` and plan with its domains and level. Unsure if it's shared → run it. It is not exploring: every level.
- Never commit, push or open a PR. Leave the changes uncommitted.
- Never use `--no-verify`.
- When closing, run `npx reins check` and `npx reins doctor` once, and say what you verified, which warnings remain and what you did not verify.
- Stop only for an ambiguous decision with consequences, growing scope, an irreversible action or repeated failures.

## On demand
- Domains, notes and minimum level for some paths (a whole domain → its folder) → `npx reins scope <paths>`.
- Resuming a task, or the conversation was compacted → run `npx reins resume`.
- "What's pending?" → `npx reins audit list` (backlog) and `npx reins progress show` (current task).
- Reviewing the diff → `npx reins review` (prompt with diff, checklist and notes).
- Workflows → `.reins/core/skills/<name>/SKILL.md` (done: closing a task; audit, backlog, notes, arch, agent); delegated roles → `.reins/core/agents/{reviewer,explorer}.md`. Your overrides in `.reins/skills/`, `.reins/agents/` win.
- Medium or large task → read `.reins/core/policies/progress.md`.
- Several agents (large only) → read `.reins/core/policies/multiagent.md`.
- Every reins command → `npx reins --help`.
