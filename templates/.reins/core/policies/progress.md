# Progress notebook and verification

Read this for medium and large tasks. The notebook is local (`.reins/progress/`, outside git), **one per task**: several tasks, one after another or in parallel sessions, can live on the same branch.

| Level | Notebook |
| --- | --- |
| small | None. Make the change and deliver |
| medium | Mini: `.reins/progress/<branch>/<task>/notebook.md` from `.reins/templates/progress-mini.md` |
| large | Hot file `notebook.md` (≤ 40 lines, what you read when resuming) from `.reins/templates/progress-hot.md`, plus `decisions.md`, `verification.md`, `delivery.md` and agent reports in the same task folder |

`<branch>` is the branch name with `/` replaced by `-` (`feat/x` → `feat-x`). `<task>` is a short name you pick from the person's request (`css-refactor`). An older `.reins/progress/<branch>.md` still works as a task without a name until it is closed.

## Which task is yours

`npx reins resume` (delivered automatically at session start by client hooks that support it) shows your task's notebook, one line for each other open task on the branch, and the files and notes of your task.

- **It shows your task:** resume from its "Next step".
- **It shows no task of yours but other open tasks:** never take one silently. If the request continues one of them, continue it by passing `--task <name>` to `npx reins progress` (that claims it for this session). If the request is new, create a task. If unclear, ask the person.
- **Every `npx reins progress` command claims the task it acts on** (`session:` in the header; the session comes from `CLAUDE_CODE_SESSION_ID` or `REINS_SESSION`). Agents without a session id: pass `--task <name>` when the branch has several open tasks.
- **Write only your own notebook.** Read the others as much as you like; never edit them.
- **Planning for another session to implement:** create the task (`npx reins progress new <task>`) and set its "Next step" to where the plan is (for example `implement docs/proposals/x.md, phase 1`). The implementing session finds the task with `resume` and continues it.

## Overlap with another session's task

The person routes work between sessions; reins does not deliver messages.

- **Asked for something close to another open task:** ask before starting. For example: "This overlaps with *css-refactor*, which another session has in progress (on 'checkout buttons', updated 20 min ago). Should I leave it to that session and do only the rest, or take it over here?" If it has not been updated for hours, say it looks abandoned. Taking it over is continuing it with `--task`.
- **You find mid-task that you need a change that belongs to another task:** stop before touching it and ask the person whether to do it here or leave it to the other session. Either way, write one line in your own notebook ("left to js-refactor: expose the size prop", or "done here: size prop, touches js-refactor").

## Rules

- At the start, run `npx reins resume` unless a session hook already delivered it.
- Write the notebook so that it is enough to continue after the conversation is compacted: the goal, the decisions taken so far and the next step, not a log of what you did.
- Write the done criteria **before** editing, not at the end.
- Update it silently after each subtask and before switching topic, not "at the end".
- Markers: `[ ]` pending, `[~]` in progress (only one), `[x]` written but not tested, `[-]` discarded with a reason (`- [-] task — reason`). Never delete discarded items: they stop the idea from coming back.
- What is needed to finish goes in the notebook. An improvement found on the way goes to the backlog (`npx reins audit add`), not into this task.
- The header says `status: open|closed`. Only the person decides a task is done: ask, then close it with `npx reins progress close`, never by editing the header. What lasts beyond the task (decisions with their why, traps, how the module works) goes to the module note in `.reins/notes/` before closing.
- Create it with `npx reins progress new <task>` (`--hot` for large tasks): it uses the templates in `.reins/templates/`. Prefer `npx reins progress done|add|next` to rewriting the file (keeps the format valid).
- Cleanup is automatic (`reins resume`): a closed task is deleted 7 days after closing or when its branch is gone; an open task only when its branch is gone and it has not changed for 7 days. An open task of a live branch is never deleted.

## Verification (once, at the end)

- Don't run tests per subtask.
- At the end: `npx reins check`, `npx reins doctor` and the related tests, once.
- If a subtask changes a shared contract (a hook signature, shared props), run a cheap check first (types or build).
- The closing message says what was verified, the doctor warnings, how many criteria are met and what was not verified.
