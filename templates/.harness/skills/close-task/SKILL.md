---
name: close-task
description: Close a coding task. Use it when the person says the task is done, asks to wrap up or close it, or before delivering a medium or large task.
---
# Close the task

1. Run once: `npx harness check`, `npx harness doctor` and the tests related to the change.
2. If the notebook exists (`.harness/progress/<branch>.md`), mark what is done (`npx harness progress done <n>`) and check the done criteria one by one.
3. Never commit, push or open a PR. Leave the changes uncommitted.
4. Reply with:
   - what changed and the files touched, with why;
   - what you verified and how (commands and results);
   - the doctor warnings that remain;
   - how many done criteria are met, and which are not;
   - what you did **not** verify.
5. Don't set `status: closed`: only the person closes the task. When they confirm, move durable decisions to the module note in `.harness/notes/`.
