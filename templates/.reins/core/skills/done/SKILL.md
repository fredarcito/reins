---
name: done
description: Close a coding task. Use it when the person says the task is done, asks to wrap up or close it, or before delivering a medium or large task.
---
# Close the task

1. Run once: `npx reins check`, `npx reins doctor` and the tests related to the change.
2. If the task has a notebook (`npx reins progress show`), mark what is done (`npx reins progress done <n>`) and check the done criteria one by one.
3. Update the module notes, so the next session doesn't rediscover this module from the code. For medium and large tasks, for each module you touched (`npx reins scope <files>` lists their notes):
   - add the decisions you took, each with its why, and the traps you found;
   - update "Map" and "How it works" if they changed;
   - a domain without a note: `npx reins notes new <domain>`, then fill in every TODO;
   - a module with parts (`.reins/notes/<module>/<part>.md`): what only concerns one part goes in that part's note, what every part shares goes in the module's note. A part with its own logic and no note: `npx reins notes new <folder>` drafts it in the module's folder;
   - nothing durable changed: leave the note as it is.
   The doctor warns about `note-outdated`, `note-missing`, `note-draft`, `note-dead-paths`/`note-dead-refs` (a note pointing at files that no longer exist): fix those notes' paths and names; and `note-uncovered` (a folder you changed that the note never names): add it to the note's Map.
4. Never commit, push or open a PR. Leave the changes uncommitted.
5. Reply with:
   - what changed and the files touched, with why;
   - what you verified and how (commands and results);
   - the doctor warnings that remain;
   - how many done criteria are met, and which are not;
   - the module notes you created or updated, and what you added;
   - what you did **not** verify.
6. Only the person decides the task is done. Ask; when they confirm, close it with `npx reins progress close`, never by editing the header. Closing lets reins delete the notebook a week later, so steps 2–3 must already be done: `close` refuses while an item is neither done nor dropped, or the doctor flags a module note of the task's files. If a flagged note really needs nothing (only a version number changed, say), close with `--notes-ok "<why>"`; never use it to skip step 3.
