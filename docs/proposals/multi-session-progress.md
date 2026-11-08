# Proposal: progress notebooks for several tasks and sessions on one branch

- **Date:** 2026-11-07, rewritten 2026-11-08
- **Status:** Design agreed on 2026-11-08 (sections 4–9). Three small questions are still open (section 11).
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

`triage.log` stays keyed by branch. Sessions on one working tree share the diff, so `triage-mismatch` comparing the shared diff with the highest level declared on the branch is still correct.

## 2. Facts this proposal relies on

- **Verified (2026-11-08):** Claude Code sets `CLAUDE_CODE_SESSION_ID` in the environment of Bash tool commands, observed in a VS Code session. `npx reins progress …` run by the agent can therefore know its session.
  - Still to test: the same in the terminal CLI.
  - Still to test: whether `claude --resume` / `--continue` keep the same id.
  - Record both results in `docs/VERIFIED.md`.
- The `SessionStart` hook payload has `session_id`. `resume --hook` already uses it for the seen-notes record. A compaction or `/clear` keeps the id.
- `.reins/progress/` is gitignored and local: every git worktree has its own notebooks, and a deleted notebook cannot be recovered from git.
- Sessions that cooperate on one feature share the code on purpose. A git worktree per session needs separate branches and a merge, so worktrees are only recommended for unrelated parallel tasks.

## 3. Principles

1. **The person only talks.** Commands are for the agent, which the policy and the skills drive. Team docs say: "talk normally; to work in parallel, open another session and tell it which part is its own".
2. **Each session writes only its own files.** Reading other tasks is allowed and encouraged; writing them is not.
3. **A task outlives a session.** Notebooks are keyed by task. A session only claims a task.
4. **Detect, ask, record.** On an overlap the agent tells the person and asks. The answer is written down where the other session will see it. It never does another session's work silently, and never takes over a task on its own.
5. **Nothing piles up.** Cleanup is automatic and never deletes open work.

## 4. Options considered

| | A. One notebook per session | B. One notebook per task (chosen) | C. One per branch, closed ones skipped | D. One file per branch, one marked block per session |
| --- | --- | --- | --- | --- |
| C1 tasks one after another | yes | yes | only for closed tasks | yes |
| C2 parallel sessions | yes | yes | no | yes, with a lock |
| C3 same task, new session | **no** (new id) | yes | yes | only if blocks are keyed by task |
| C4 no session id | weak | yes | yes | yes |
| C5 new session, previous task open | yes | yes | **no** | yes |
| Concurrent writes | safe | safe | unsafe | **unsafe** without a lock; agents that edit the file by hand can overwrite other blocks |

D, proposed on 2026-11-08, gives one place to see the whole feature. B keeps that as a **read view** (section 5) and keeps the writes in separate files.

## 5. Design

### Files

```
.reins/progress/
├── feat-checkout.md                  # feature notebook (optional): goal of the feature and who does what
├── feat-checkout@js-refactor.md      # one notebook per task
├── feat-checkout@js-refactor/        # its cold folder (large tasks): decisions, verification, delivery, agent reports
├── feat-checkout@css-refactor.md
└── feat-checkout@verify.md
```

- `<branch>@<task>.md` (flat). `@` never appears in a branch slug, because `notebookFile` turns everything outside `[\w.-]` into `-`.
- `<branch>.md` is today's notebook. It needs no migration: it keeps working as the branch's only notebook, and it can also be the **feature notebook** (below).
- `<task>` is a short slug the agent picks from the person's request (`css-refactor`) (Q5).

### Feature notebook (optional)

The feature notebook holds only what belongs to no single task: the goal of the feature, its done criteria ("checkout works end to end") and the split, when there is one.

- **Optional.** The session where the person describes a split feature creates it ("let's do the checkout in 3 sessions: JS, CSS and verify"). If someone opens sessions without describing a feature, there is none, and the read view still shows every task.
- **No progress in it.** Status comes from the task notebooks (open, closed, `[~]` item, requests), and reins composes it in the read view.
- **It changes rarely:**
  - at the start;
  - when the plan changes ("also do the images part"), updated by the session that receives the request;
  - at the end, when the verifying session checks the feature criteria and the person closes it.
- **Any session may change it, but only through `reins`**, never by hand. reins re-reads the file right before writing. Changes are rare, so the chance of two sessions writing at the same moment is minimal. This replaces "only the coordinating session writes it": when the person splits the work by opening sessions, there may be no coordinating session.

### Header

```markdown
# feat/checkout · task: css-refactor · session: 3f9c… · status: open · updated: 2026-11-09
```

`task:` and `session:` are optional, so today's header stays valid. `reins` writes `session:`, never a person: it holds the session that claimed the task.

New optional line in the body, for requests to other tasks (section 7):

```markdown
**Needs:** js-refactor — expose the size prop in Checkout.jsx
```

### Which task a session works on

The first rule that matches wins:

1. An explicit task (`--task <name>` or `REINS_TASK`).
2. The open notebook whose `session:` is this session. The session comes from the hook payload, `CLAUDE_CODE_SESSION_ID` or `REINS_SESSION`. This rule covers compaction and `/clear`.
3. Otherwise none yet: the session has not chosen. `resume` lists the open tasks of the branch and tells the agent:
   - the request matches one → continue it;
   - the request is new → create a task;
   - unclear → ask the person.

**A new session never takes a task silently**, not even the only open one. At session start, reins cannot tell "continue yesterday's task" (C3) from "next task" (C5); the person's first message can.

**Exception, no session id (C4):** with a single open notebook and no session id, rule 3 picks it, as today. `resume` still says "if the request is a different task, create a new one".

### What a session sees (the read view)

`resume`, at session start and after a compaction, prints:

1. Its own notebook, when it has one.
2. **Other open tasks on the branch**: task, goal, the `[~]` item, last update, whether another session holds it.
3. **Requests to this task** from other notebooks (`**Needs:** <this task> — …`).
4. Files changed on the branch, and the notes for them, as today.

Every `reins progress` edit (the agent runs one after each subtask) ends with what is **new** from other sessions since this session last looked: new requests, tasks created, tasks closed. This is how a session learns about the others mid-task, without anyone writing its file.

Closed notebooks are never shown as current work. While their branch exists, they appear in the list as done ("js-refactor: done"), so the verification session knows.

## 6. Lifecycle, as the person sees it

| The person says | The agent does |
| --- | --- |
| "Refactor the checkout CSS" | Creates the `css-refactor` task |
| (new session) "Continue the CSS work" | Finds `css-refactor` and continues it |
| (new session) "Now fix the login" | Sees it is new, creates `login-fix`, leaves the others alone |
| "Done, close it" | Runs the `done` skill (verify, move decisions to module notes and improvements to the backlog), asks for confirmation, closes the task |

- Only the person closes a task, as today. The agent asks, then closes it with a `reins` command instead of editing the header by hand.
- Closing the feature notebook while tasks are still open makes the agent list them and ask: close them, drop them, or keep them.

## 7. Overlap between sessions (C6)

**A new session is asked for something close to an open task.** The agent sees the other tasks in `resume` and asks before starting:

> "This overlaps with *css-refactor*, which another session has in progress (on 'checkout buttons', updated 20 min ago). Should I:
> a) leave it to that session and do only what it doesn't cover,
> b) wait for it to finish, or
> c) take it over here?"

- If the other task has not been updated for hours, the agent says it looks abandoned and offers to take it over.
- A takeover moves `session:` to this session. If the old session edits it later, reins tells it that another session holds the task now.

**A session finds mid-task that it needs another task's change.** For example, the CSS session needs a change in `Checkout.jsx`, which the JS session is refactoring. The agent stops before touching it and asks:

> "To finish I need to change `Checkout.jsx`, which belongs to *js-refactor* in another session. Should I leave the request there and go on with the rest, or do it myself?"

- **Leave the request:** a `**Needs:** js-refactor — …` line in its own notebook, and that subtask waits. The JS session sees the request on its next `reins progress` edit or `resume`.
- **Do it here:** it records `done here: <change> (touches js-refactor)` in its own notebook, so the JS session neither redoes it nor overwrites it.

## 8. Cleanup (automatic)

`resume` tidies the notebooks every time a session starts. It runs automatically through the hook, and other agents run it at the start because the policy says so.

| Notebook | What happens |
| --- | --- |
| Closed, branch no longer exists (merged and deleted) | Deleted, with its cold folder |
| Closed for more than 7 days (covers `main`) | Deleted |
| Closed, recent, branch exists | Kept, shown as done |
| Open, branch no longer exists, no changes for 7 days | Deleted, with its cold folder |
| Open, branch no longer exists, changed in the last 7 days | Kept; shown in "other open tasks" marked *branch deleted* |
| Open, branch exists | **Never deleted**, however old: it is paused work |

In one line: **delete closed notebooks older than 7 days, closed notebooks of deleted branches, and open notebooks of deleted branches after 7 days without changes. Never delete an open notebook whose branch exists.**

- "Branch exists" means a local branch or a remote-tracking ref. A branch deleted locally whose PR is still open does not count as deleted.
- Deleting a closed notebook is safe: closing already moved what matters into module notes and the backlog.
- An open notebook of a deleted branch usually means the branch was merged and nobody closed the task, so the code is already in the base branch. What is lost is only the decisions nobody moved to notes. The 7-day margin covers the rare renamed branch: during that time, a session that finds the task useful continues it on its own branch. **The person is never asked.**
- **What the agent hears about it:**
  - Closed notebooks are removed **silently**. This is the common, safe case, and it costs no tokens.
  - Removing an **open** notebook (deleted branch, 7 days without changes) adds one line to `resume`, about 15 tokens. It is rare, and it is the one removal that could lose something.
- **Cleanup log:** every removal is appended to `.reins/progress/cleanup.log` (date, task, branch, reason). Writing it costs no tokens. It is read only when needed:
  - when an agent asks for a task that is gone, `progress` answers "css-refactor was removed on 2026-11-16: its branch feat/checkout no longer exists" instead of "not found";
  - when a cleanup bug is suspected, there is a trace (notebooks are outside git and cannot be recovered).
- Hook rule: any error means nothing is deleted and nothing is printed, and the session starts normally.
- There is no `clean` command and no stale warning in `doctor`: nothing piles up for the person to handle.
- Removing a git worktree removes its notebooks too.

## 9. Token budget

Cleanup, the date checks and the branch checks run inside `reins` (Node and git), outside the model, so they cost no tokens. Only text that reins puts into the context costs tokens. Limits:

1. **Other tasks are always summaries**: 1–2 lines each, about 30–50 tokens, never the full notebook. At most the 5 most recently updated, then "and N more".
2. **Closed tasks take one line in total** ("done: js-refactor, verify"). With no other open task on the branch, they are left out.
3. **Silent cleanup**, except for removing an open notebook (one line). Details are in `cleanup.log` (section 8).
4. **"New from other sessions" prints only when there is something new.** Otherwise a `reins progress` edit prints exactly what it prints today.
5. **The `AGENTS.md` rules block**, which is in every session's context, grows by one line at most. The detail goes into `progress.md`, read only for medium and large tasks.

Expected effect:
- With a single session on a branch, the context is the same as today or smaller: a previous task's notebook is no longer delivered to a new session.
- With three parallel sessions, each one pays about 100 extra tokens to see the other two.

## 10. Out of scope

- **Warning when a session is about to edit a file another task "owns".** Rejected on 2026-11-08: it needs every task to register its files. Asking on overlaps (section 7) is enough.
- A shared lock or marked blocks in one file (option D).
- Messages between live sessions through a provider's own channel: not provider-neutral and not tested.
- Changes to `triage.log`.

## 11. Open questions

- **Q2.** Settled as flat `<branch>@<task>.md`, unless the person prefers a folder per branch. A folder per branch would collide with today's cold folder and need a local migration.
- **Q5.** Who names the task when the person does not? Proposal: the agent, as a short slug from the request (`css-refactor`).
- **Q7.** Is 7 days the right margin, both for closed notebooks and for open notebooks of deleted branches? Proposal: 7, configurable in `doctor.yml` (`progress.cleanup_days`).

## 12. Implementation outline

- **`core`** (`packages/core/src/doctor/progress.js`, `progress-edit.js`):
  - `notebookFile(branch, task?)`.
  - `HEADER_RE` accepts optional `task:` and `session:`.
  - `newNotebook(template, branch, date, { task, session })`.
  - `summarizeNotebook(text)`: `{ task, session, status, updated, goal, inProgress, next, needs }`.
  - Pure `cleanupPlan(notebooks, branches, today, days)`, where `branches` includes remote-tracking refs.
  - Tests next to the code.
- **`cli`:**
  - `listBranchNotebooks(root, branch)` in `project.js`.
  - One resolution helper shared by `progress`, `resume` and `doctor`.
  - `progress`:
    - `new <task>`, `list`, `close`;
    - `--task`;
    - claims via `session:`;
    - "new from other sessions" after each edit (last-seen state next to `.notes-seen.json`).
  - `resume`: the read view, cleanup and `cleanup.log`; summaries capped as in section 9.
  - `doctor`: every open notebook of the branch.
- **Templates:**
  - `templates/.reins/core/policies/progress.md`: one notebook per task, how to choose a task, overlaps, cleanup.
  - `templates/.reins/core/policies/multiagent.md`: reports go into the task's cold folder.
  - `templates/.reins/core/skills/done/SKILL.md`: close the resolved task.
  - The rules block wording, if needed.
  - `reins sync` refreshes `.reins/core/`.
- **Docs:**
  - `docs/DECISIONS.md`: the decision and the rejected options A, C and D.
  - `docs/DESIGN.md`: progress section.
  - `docs/VERIFIED.md`: session id facts.
  - `docs/STATUS.md`.
  - `README.md`: "talk normally; to work in parallel, open another session", with a diagram.
  - `CHANGELOG.md`.
  - The `cli` and `core` module notes.
- **Verification:** `pnpm lint && pnpm test && pnpm self-check` once at the end. Then real Claude Code sessions on one branch:
  - two tasks one after another, the first left open;
  - a task continued from a new session;
  - three parallel sessions (JS, CSS, verify): each sees the others, none writes another's notebook, and a `**Needs:**` request reaches the other session;
  - cleanup after deleting a merged branch.
- **Size:** large (core, cli, policies, skill, docs). Run it as a large task with a hot notebook, starting with the session id checks in section 2.
