# Proposal: progress notebooks for several tasks and sessions on one branch

- **Date:** 2026-11-07, rewritten 2026-11-08, trimmed 2026-11-08
- **Status:** Phase 1 implemented on 2026-11-08 (summary in `docs/DECISIONS.md`); phase 2 waits for real use (section 9).
- **Scope:** `@agentreins/core` (notebook paths and parsing), `@agentreins/cli` (`progress`, `resume`, `doctor`), the progress and multiagent policies, the `done` skill.

## 1. Problem

Today a branch has exactly one notebook, `.reins/progress/<branch>.md`. The cold folder of a large task is `.reins/progress/<branch>/`. Three commands find the notebook with `notebookFile(branch)`:

- `progress`: `new` refuses to run if the file already exists.
- `resume`, including the `SessionStart` hook: delivers that file to every session that starts on the branch.
- `doctor`: checks that file only.

| Case | What happens today |
| --- | --- |
| **C1. Tasks one after another on the same branch** (typical on `main` or a long-lived branch) | A new session gets the notebook of the previous task, even when it is closed. `progress new` fails until someone deletes the file by hand. |
| **C2. Several sessions at the same time on one feature** (one refactors the JS, another the CSS, a third checks that everything works), on the same branch and the same working tree on purpose | All of them edit the same file. Item numbers shift under the other sessions, and they fight over the single `[~]` item. No session knows what the others are doing. |
| **C3. The same task continued in a new session** (next day, a new terminal) | Works today, because the notebook is found by branch. **Must keep working.** |
| **C4. Agents without a session id** (Codex, Cursor; reins has been provider-neutral since 0.8.0) | Works today, for the same reason. **Must keep working.** |
| **C5. A new session for the next task** (recommended practice: a fresh session per task, for a clean context), often with the previous notebook still open | The new session receives the previous task as if it were its own. |
| **C6. Overlap between sessions**: a new session is asked for something close to another session's open task, or a session finds mid-task that it needs a change that belongs to another session's task | Nothing detects it. Work is duplicated or overwritten. |

## 2. Facts this proposal relies on

- **Verified (2026-11-08, `docs/VERIFIED.md` P11):** Claude Code sets `CLAUDE_CODE_SESSION_ID` in the environment of Bash tool commands, in the VS Code extension and in the terminal CLI (print mode). `npx reins progress …` run by the agent can therefore know its session.
  - `claude --resume` and `--continue` keep the same id; `--fork-session` gets a new one.
  - Not tested: the interactive terminal UI.
- The `SessionStart` hook payload has `session_id`. `resume --hook` already uses it for the seen-notes record. A compaction or `/clear` keeps the id.
- `.reins/progress/` is gitignored and local: every git worktree has its own notebooks, and a deleted notebook cannot be recovered from git.
- Sessions that cooperate on one feature share the code on purpose. A git worktree per session needs separate branches and a merge, so worktrees are only recommended for unrelated parallel tasks.

## 3. Principles

1. **The person only talks.** Commands are for the agent, which the policy and the skills drive. Team docs say: "talk normally; to work in parallel, open another session and tell it which part is its own".
2. **Each session writes only its own notebook.** Reading other tasks is allowed and encouraged; writing them is not.
3. **A task outlives a session.** Notebooks are keyed by task. A session only claims a task.
4. **The person routes between sessions.** On an overlap the agent tells the person and asks. The person is already talking to every session, so reins needs no messaging between them.
5. **Nothing piles up.** Cleanup is automatic and never deletes open work on a live branch.
6. **Build only what real use asked for.** Anything that solves a case nobody has hit yet waits for phase 2.

## 4. Options considered

| | A. One notebook per session | B. One notebook per task (chosen) | C. One per branch, closed ones skipped | D. One file per branch, one marked block per session |
| --- | --- | --- | --- | --- |
| C1 tasks one after another | yes | yes | only for closed tasks | yes |
| C2 parallel sessions | yes | yes | no | yes, with a lock |
| C3 same task, new session | **no** (new id) | yes | yes | only if blocks are keyed by task |
| C4 no session id | weak | yes | yes | yes |
| C5 new session, previous task open | yes | yes | **no** | yes |
| Concurrent writes | safe | safe | unsafe | **unsafe** without a lock; agents that edit the file by hand can overwrite other blocks |

D, proposed on 2026-11-08, gives one place to see the whole feature. B gives that as a **read view** in `resume` (section 5) and keeps the writes in separate files.

## 5. Design (phase 1)

### Files

```
.reins/progress/
└── feat-checkout/                # one folder per branch
    ├── js-refactor/              # one folder per task
    │   ├── notebook.md           # the notebook: what a session reads when resuming
    │   ├── decisions.md          # cold files, large tasks only: decisions, verification, delivery, agent reports
    │   └── verification.md
    ├── css-refactor/
    │   └── notebook.md
    └── verify/
        └── notebook.md
```

- `<branch>/<task>/notebook.md`, chosen on 2026-11-08 over a flat `<branch>@<task>.md` and over separate notebook and cold subfolders: a task is one folder, so reading, closing or deleting it touches one place.
- `<task>` is a short slug the agent picks from the person's request (`css-refactor`).
- The tasks of a branch are the subfolders of its branch folder that contain a `notebook.md`.
- **No migration.** Today's `<branch>.md` is read as a task with no name, and its cold files stay where they are, as plain files in `<branch>/` (`decisions.md`, `verification.md`, agent reports). Plain files are never tasks, so they cannot be confused with one.
- When a branch folder is left empty after cleanup, it is removed too.

### Header

```markdown
# feat/checkout · task: css-refactor · session: 3f9c… · status: open · updated: 2026-11-09
```

`task:` and `session:` are optional, so today's header stays valid. `reins` writes `session:`, never a person. It holds the last session that claimed the task, nothing more: there is no ownership check and no warning to a previous session.

### Which task a session works on

The first rule that matches wins:

1. An explicit task (`--task <name>` or `REINS_TASK`).
2. The open notebook whose `session:` is this session. The session comes from the hook payload, `CLAUDE_CODE_SESSION_ID` or `REINS_SESSION`. This rule covers compaction and `/clear`.
3. Otherwise none yet: the session has not chosen. `resume` lists the open tasks of the branch and tells the agent:
   - the request matches one → continue it (this claims it);
   - the request is new → create a task;
   - unclear → ask the person.

**A new session never takes a task silently**, not even the only open one. At session start, reins cannot tell "continue yesterday's task" (C3) from "next task" (C5); the person's first message can.

**Exception, no session id (C4):** with a single open notebook and no session id, rule 3 picks it, as today. `resume` still says "if the request is a different task, create a new one".

### What a session sees (the read view)

`resume`, at session start and after a compaction, prints:

1. Its own notebook, when it has one.
2. **Other open tasks on the branch**, one or two lines each: task, goal, the `[~]` item, last update.
3. Files changed on the branch, and the notes for them, as today.

Closed notebooks are never shown as current work. While other tasks are open on the branch, they take one line in total ("done: js-refactor, verify"), so the verification session knows.

`resume` reads the files every time and keeps no state about what a session has already seen.

## 6. Lifecycle, as the person sees it

| The person says | The agent does |
| --- | --- |
| "Refactor the checkout CSS" | Creates the `css-refactor` task |
| (new session) "Continue the CSS work" | Finds `css-refactor` and continues it |
| (new session) "Now fix the login" | Sees it is new, creates `login-fix`, leaves the others alone |
| "Done, close it" | Runs the `done` skill (verify, move decisions to module notes and improvements to the backlog), asks for confirmation, closes the task |

Only the person closes a task, as today. The agent asks, then closes it with a `reins` command instead of editing the header by hand.

## 7. Overlap between sessions (C6): policy only

There is no code for overlaps. The progress policy tells the agent what to do with what `resume` already shows.

**A new session is asked for something close to an open task.** The agent asks before starting:

> "This overlaps with *css-refactor*, which another session has in progress (on 'checkout buttons', updated 20 min ago). Should I leave it to that session and do only the rest, or take it over here?"

If the other task has not been updated for hours, the agent says it looks abandoned. Taking it over is just continuing it (rule 3), which moves `session:`.

**A session finds mid-task that it needs another task's change.** The agent stops before touching it and asks the person whether to do it here or leave it to the other session. Either way it writes one line in its own notebook (for example "left to js-refactor: expose the size prop", or "done here: size prop, touches js-refactor"). The person tells the other session; reins does not deliver it.

## 8. Cleanup (automatic)

`resume` tidies the notebooks every time a session starts. It runs automatically through the hook, and other agents run it at the start because the policy says so. Two rules, with a fixed margin of 7 days:

- **Closed** task: its folder is deleted when it was closed more than 7 days ago or its branch no longer exists.
- **Open** task: its folder is deleted when its branch no longer exists and its notebook has not changed for 7 days. An open task whose branch exists is **never** deleted, however old: it is paused work.

Details:

- "Branch exists" means a local branch or a remote-tracking ref, so a branch deleted locally whose PR is still open is not treated as gone. This check is shared with the `triage.log` cleanup of backlog A2.
- Deleting a closed notebook is safe: closing already moved what matters into module notes and the backlog.
- An open notebook of a deleted branch usually means the branch was merged and nobody closed the task. The 7 days cover the rare renamed branch.
- Closed notebooks are removed silently. Removing an open one adds one line to `resume`, the one removal that could lose something.
- Hook rule: any error means nothing is deleted and nothing is printed, and the session starts normally.
- There is no `clean` command, no cleanup log, no setting and no stale warning in `doctor`.

## 9. Phase 2: only if real use asks for it

Kept here so the ideas are not lost. None of them is built in phase 1.

- **Feature notebook** (`<branch>.md` with the goal, done criteria and split of a feature): add it if people miss one place for the feature's goal. Until then the goal lives in each task and the read view shows all tasks.
- **Requests between tasks** (a `**Needs:** <task> — …` line that `resume` and `progress` show to the target task): add it if the person routing messages by hand turns out to be a real burden.
- **"New from other sessions" after each `progress` edit**: needs a per-session last-seen state file. Add it only together with requests.
- **Cleanup log and "removed on <date>" answers, configurable margin**: add them if a wrong or surprising removal is ever reported.

## 10. Token budget

Cleanup, the date checks and the branch checks run inside `reins` (Node and git), outside the model, so they cost no tokens. Only text that reins puts into the context costs tokens. Limits:

1. **Other tasks are always summaries**: 1–2 lines each, about 30–50 tokens, never the full notebook. At most the 5 most recently updated, then "and N more".
2. **Closed tasks take one line in total**, and none when no other task is open on the branch.
3. **Silent cleanup**, except for removing an open notebook (one line).
4. **The `AGENTS.md` rules block**, which is in every session's context, grows by one line at most. The detail goes into `progress.md`, read only for medium and large tasks.

Expected effect:
- With a single session on a branch, the context is the same as today or smaller: a previous task's notebook is no longer delivered to a new session.
- With three parallel sessions, each one pays about 100 extra tokens to see the other two.

## 11. Out of scope

- **Warning when a session is about to edit a file another task "owns".** Rejected on 2026-11-08: it needs every task to register its files. Asking on overlaps (section 7) is enough.
- A shared lock or marked blocks in one file (option D).
- Messages between live sessions through a provider's own channel: not provider-neutral and not tested.
- Changes to `triage.log` beyond backlog A2.
- **Showing small tasks to other sessions.** Small tasks have no notebook, so the read view does not list them. Accepted on 2026-11-08: a small task touches about one file and is over quickly, so other sessions lose little by not seeing it.

## 12. Implementation outline (phase 1)

- **`core`** (`packages/core/src/doctor/progress.js`, `progress-edit.js`):
  - `notebookFile(branch, task?)`: `<branch>/<task>/notebook.md`, or today's `<branch>.md` without a task.
  - `taskFolder(branch, task)`: where the task's cold files and agent reports go.
  - `HEADER_RE` accepts optional `task:` and `session:`.
  - `newNotebook(template, branch, date, { task, session })`.
  - `summarizeNotebook(text)`: `{ task, session, status, updated, goal, inProgress }`.
  - Pure `cleanupPlan(notebooks, liveBranches, today)`.
  - Tests next to the code.
- **`cli`:**
  - `listBranchNotebooks(root, branch)` and the shared "live branches" helper (local plus remote-tracking refs, also used by A2) in `project.js`.
  - One resolution helper shared by `progress`, `resume` and `doctor`.
  - `progress`: `new <task>`, `close`, `--task`; claims via `session:`.
  - `resume`: the read view and the cleanup; summaries capped as in section 10.
  - `doctor`: every open notebook of the branch.
- **Templates:**
  - `templates/.reins/core/policies/progress.md`: one notebook per task, how to choose a task, overlaps (section 7), cleanup.
  - `templates/.reins/core/policies/multiagent.md`: reports go into the task's folder (`<branch>/<task>/<agent>_<subtask>.md`).
  - `templates/.reins/core/skills/done/SKILL.md`: close the resolved task.
  - The rules block wording, if needed.
  - `reins sync` refreshes `.reins/core/`.
- **Docs:**
  - `docs/DECISIONS.md`: the decision, the rejected options A, C and D, and what was deferred to phase 2.
  - `docs/DESIGN.md`: progress section.
  - `docs/VERIFIED.md`: session id facts.
  - `docs/STATUS.md`.
  - `README.md`: "talk normally; to work in parallel, open another session", with a diagram.
  - `CHANGELOG.md`.
  - The `cli` and `core` module notes.
- **Verification:** `pnpm lint && pnpm test && pnpm self-check` once at the end. Then real Claude Code sessions on one branch:
  - two tasks one after another, the first left open;
  - a task continued from a new session, and after a compaction;
  - three parallel sessions (JS, CSS, verify): each sees the others and none writes another's notebook;
  - cleanup after deleting a merged branch.
- **Size:** medium (core, cli, policy, skill, docs). Do it after backlog A2, which brings the shared live-branches helper. Start with the session id checks in section 2.
