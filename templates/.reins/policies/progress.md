# Progress notebook and verification

Read this for medium and large tasks. The notebook is local (`.reins/progress/`, outside git), one per branch.

| Level | Notebook |
| --- | --- |
| small | None. Make the change and deliver |
| medium | Mini: `.reins/progress/<branch>.md` from `.reins/templates/progress-mini.md` |
| large | Hot file `.reins/progress/<branch>.md` (≤ 40 lines, what you read when resuming) from `.reins/templates/progress-hot.md`, plus a cold folder `.reins/progress/<branch>/` with `decisions.md`, `verification.md`, `delivery.md` and agent reports |

`<branch>` is the branch name with `/` replaced by `-` (`feat/x` → `feat-x.md`).

## Rules

- At the start, if the notebook exists, read it and resume from "Next step". `npx reins resume` prints the notebook, the files changed on the branch and their module notes; in Claude Code it arrives on its own when a session starts, after `/clear` and after a compaction.
- Write the notebook so that it is enough to continue after the conversation is compacted: the goal, the decisions taken so far and the next step, not a log of what you did.
- Write the done criteria **before** editing, not at the end.
- Update it silently after each subtask and before switching topic, not "at the end".
- Markers: `[ ]` pending, `[~]` in progress (only one), `[x]` written but not tested, `[-]` discarded with a reason (`- [-] task — reason`). Never delete discarded items: they stop the idea from coming back.
- What is needed to finish goes in the notebook. An improvement found on the way goes to the backlog (`npx reins audit add`), not into this task.
- The header says `status: open|closed`. Only the person closes it. What lasts beyond the task (decisions with their why, traps, how the module works) goes to the module note in `.reins/notes/` when closing; then the notebook can be deleted.
- Create it with `npx reins progress new` (`--hot` for large tasks): it uses the templates in `.reins/templates/`. Prefer `npx reins progress done|add|next` to rewriting the file (keeps the format valid).

## Verification (once, at the end)

- Don't run tests per subtask.
- At the end: `npx reins check`, `npx reins doctor` and the related tests, once.
- If a subtask changes a shared contract (a hook signature, shared props), run a cheap check first (types or build).
- The closing message says what was verified, the doctor warnings, how many criteria are met and what was not verified.
