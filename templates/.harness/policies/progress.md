# Progress notebook and verification

Read this for medium and large tasks. The notebook is local (`.harness/progress/`, outside git), one per branch.

| Level | Notebook |
| --- | --- |
| small | None. Make the change and deliver |
| medium | Mini: `.harness/progress/<branch>.md` from `.harness/templates/progress-mini.md` |
| large | Hot file `.harness/progress/<branch>.md` (≤ 40 lines, what you read when resuming) from `.harness/templates/progress-hot.md`, plus a cold folder `.harness/progress/<branch>/` with `decisions.md`, `verification.md`, `delivery.md` and agent reports |

`<branch>` is the branch name with `/` replaced by `-` (`feat/x` → `feat-x.md`).

## Rules

- At the start, if the notebook exists, read it and resume from "Next step".
- Write the done criteria **before** editing, not at the end.
- Update it silently after each subtask and before switching topic, not "at the end".
- Markers: `[ ]` pending, `[~]` in progress (only one), `[x]` written but not tested, `[-]` discarded with a reason (`- [-] task — reason`). Never delete discarded items: they stop the idea from coming back.
- What is needed to finish goes in the notebook. An improvement found on the way goes to the backlog (`npx --no-install harness audit add`), not into this task.
- The header says `status: open|closed`. Only the person closes it. Then move what lasts to the module note and delete the notebook.
- Prefer `npx --no-install harness progress done|add|next` to rewriting the file (keeps the format valid).

## Verification (once, at the end)

- Don't run tests per subtask.
- At the end: `npx --no-install harness check`, `npx --no-install harness doctor` and the related tests, once.
- If a subtask changes a shared contract (a hook signature, shared props), run a cheap check first (types or build).
- The closing message says what was verified, the doctor warnings, how many criteria are met and what was not verified.
