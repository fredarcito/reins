# Proposal: Multi-Session Progress Notebooks per Branch

- **Date:** 2026-11-07
- **Status:** Proposed (Ready for implementation)
- **Scope:** `@agentreins/core`, `@agentreins/cli`, policies, templates

---

## 1. Problem Statement

Reins currently couples **branch**, **task**, and **session** 1:1:
- The progress notebook is stored as a flat file: `.reins/progress/<branch>.md`.
- `reins progress new` fails if `.reins/progress/<branch>.md` already exists.
- `reins resume --hook` only inspects `git rev-parse --abbrev-ref HEAD` and delivers `.reins/progress/<branch>.md` to any session starting on that branch.

### Why this breaks in practice
In real agent workflows (especially Claude Code, multiple terminal tabs, subagents, or working on persistent branches like `main` or long-lived feature branches):
1. **Write collisions:** Multiple concurrent sessions on the same branch compete for `.reins/progress/<branch>.md`, trampling line numbers, markers (`[~]`), and subtasks.
2. **Context pollution:** A new session starting on `main` for Task B receives the complete, stale notebook of Task A from `reins resume`.
3. **Sequential task blocking:** Once a task is done on a branch, starting a new task requires manually deleting or overwriting `<branch>.md`.
4. **Triage conflation:** `triage.log` keys lines by branch (`YYYY-MM-DD | branch | level | reason`), conflating the diffs of multiple sessions/tasks on the same branch.

---

## 2. Core Solution: Isolated Writes, Coordinated Reads

To solve this, we decouple the three concepts:
- **Git Branch:** The repository's code changes (`git diff`).
- **Task:** The unit of work (objective, done criteria, subtasks, next step).
- **Session:** The runtime agent conversation instance (e.g. `CLAUDE_CODE_SESSION_ID`).

### Architecture Principle
* **Isolated writes:** Each session writes strictly to its own notebook inside the branch's folder.
* **Coordinated reads:** When a session starts or resumes, `reins resume` delivers its own notebook plus an executive summary of other active sessions on the branch to prevent duplicate work.

---

## 3. File Layout

Instead of a flat `.reins/progress/<branch>.md`, each branch has its own folder containing session notebooks:

```
.reins/progress/
├── triage.log
└── <branch>/
    ├── <session-1>.md          # Hot notebook for session 1
    ├── <session-1>/            # Cold folder for session 1 (decisions, verification, reports)
    ├── <session-2>.md          # Hot notebook for session 2
    └── ...
```

*Note on backwards compatibility:* Existing single files (`.reins/progress/<branch>.md`) remain recognized and supported.

---

## 4. Session Resolution Order

How `reins` resolves which session notebook to use:

1. **CLI Flag:** `--session <id>` (passed explicitly to `reins progress` or `reins resume`).
2. **Hook Payload:** `session_id` in JSON from stdin (Claude Code `SessionStart` and `PreToolUse` hooks).
3. **Subprocess Environment:** `process.env.CLAUDE_CODE_SESSION_ID` (automatically set by Claude Code in all Bash tool subprocesses) or `process.env.REINS_SESSION`.
4. **Positional Name on creation:** `reins progress new <task-name>` (creates `<task-name>.md`).
5. **Fallback / Auto-discovery:**
   - If exactly one open notebook exists in `.reins/progress/<branch>/`, use it.
   - If legacy `.reins/progress/<branch>.md` exists, use it.
   - Otherwise, default to a generated session identifier (e.g., `s1`).

---

## 5. Notebook Header Format

Notebook headers support an optional `session:` field:

```markdown
# <branch> · session: <session_id> · status: open · updated: YYYY-MM-DD
**Goal:** Implement Google OAuth login
**Done criteria:**
- [ ] Users can log in with Google
**Subtasks:**
- [~] Add OAuth callback handler
**Next step:** Test callback with mock tokens
```

Legacy headers without `session:` remain valid:
```markdown
# <branch> · status: open · updated: YYYY-MM-DD
```

---

## 6. Coordinated Resumption (`reins resume`)

When a session starts or the context is compacted, `reins resume` outputs:

1. **Own Notebook:**
   ```markdown
   ## Progress notebook .reins/progress/<branch>/<session>.md
   Resume from its "Next step"; keep it updated with `npx reins progress`.
   ...
   ```
2. **Other Active Sessions Awareness Summary:**
   If other sessions have open notebooks on the same branch:
   ```markdown
   ## Other active sessions on this branch (1)
   - Session c3d4 (updated 2026-11-07): Goal: "Password reset flow" · In progress: "[~] email validation"

   Notice: If the user asks for a task already covered in another active session, alert the user:
   "This task is tracked in session <id>. Would you like to switch to that session or continue it here?"
   ```
3. **Files changed on the branch & Module notes.**

---

## 7. Implementation Plan

### Step 1: `@agentreins/core`
- Update `HEADER_RE` in `packages/core/src/doctor/progress.js` to optionally parse `session: <name>`.
- Update `notebookFile(branch, session = null)` to return `.reins/progress/<branch>/<session>.md` when `session` is provided.
- Add `summarizeNotebook(text, file)` to extract `{ branch, session, status, updated, goal, inProgress, nextStep }`.
- Update `newNotebook(template, branch, date, session = null)` in `progress-edit.js`.
- Export the new utilities in `packages/core/src/index.js`.
- Add unit tests in `packages/core/test/doctor.test.js`.

### Step 2: `@agentreins/cli` Project Helpers
- Add `listBranchNotebooks(root, branch)` in `packages/cli/src/project.js` to scan `.reins/progress/<branch>/` and detect both session notebooks and legacy `<branch>.md`.

### Step 3: `@agentreins/cli` Commands
- Update `packages/cli/src/commands/resume.js`:
  - Pass resolved session to `gather(root, env, session)`.
  - Format own notebook + awareness summary of other open sessions on the branch.
- Update `packages/cli/src/commands/progress.js`:
  - Support `--session` option and positional task name on `new`.
  - Resolve active session from environment / arguments.
  - Create `<session>/` cold folder when `--hot` is specified.
- Update `packages/cli/src/commands/doctor.js`:
  - Discover all branch notebooks via `listBranchNotebooks` and check each with `runDoctor`.

### Step 4: Documentation & Policies
- Update `docs/DECISIONS.md` with the finalized decision.
- Update `docs/DESIGN.md` tree and progress section.
- Update `templates/.reins/policies/progress.md` and `templates/.reins/skills/done/SKILL.md`.

### Step 5: Verification
- Run `pnpm lint && pnpm test && pnpm self-check`.
- Verify full suite passes.
