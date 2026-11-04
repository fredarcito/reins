---
name: close-task
description: Close a coding task. Use it when the person says the task is done, asks to wrap up or close it, or before delivering a medium or large task.
---
# Close the task

1. Run once: `npx reins check`, `npx reins doctor` and the tests related to the change.
2. If the notebook exists (`.reins/progress/<branch>.md`), mark what is done (`npx reins progress done <n>`) and check the done criteria one by one.
3. Update the module notes, so the next session doesn't rediscover this module from the code. For medium and large tasks, for each module you touched (`npx reins scope <files>` lists their notes):
   - add the decisions you took, each with its why, and the traps you found;
   - update "Map" and "How it works" if they changed;
   - a domain without a note: `npx reins notes new <domain>`, then fill in every TODO;
   - nothing durable changed: leave the note as it is.
   The doctor warns about `note-outdated`, `note-missing` and `note-draft`.
4. Never commit, push or open a PR. Leave the changes uncommitted.
5. Reply with:
   - what changed and the files touched, with why;
   - what you verified and how (commands and results);
   - the doctor warnings that remain;
   - how many done criteria are met, and which are not;
   - the module notes you created or updated, and what you added;
   - what you did **not** verify.
6. Don't set `status: closed`: only the person closes the task.
