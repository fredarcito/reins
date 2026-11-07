---
name: notes
description: Fill in, improve or review the module notes in .reins/notes/ (purpose, map, how it works, decisions, traps). Use it after reins init or reins notes new, when reins doctor reports note-draft, note-dead-paths or note-dead-refs, when asked to document a module, or with "review" to check notes that fell behind their code.
---
# Fill in module notes

A note is for someone who has never seen the module and has to change it safely today. If the code says something plainly, it doesn't go in the note.

1. Find the notes to fill: the lines starting with `TODO` in `.reins/notes/*.md` and `.reins/notes/<module>/*.md` (`npx reins doctor` reports them as `note-draft`). If the person named a module, do only that one.
2. For each note, read the code under its `paths`: the public API first, then the most imported files listed in its Map. Stop when you can explain the module; don't read all of it.
3. Replace every `TODO` line:
   - **Purpose:** what the module does and for whom, in one or two lines.
   - **Map:** one line per key file worth knowing. Keep the lines reins generated (public API, files, used by, depends on).
   - **How it works:** the main flow in a few lines: where the data comes from, what changes it, who reads it.
   - **Decisions:** only what the code, its comments, the git history (`git log --follow <file>`) or the person confirm, each with its date and its why. **Never invent a reason.** If you can't tell why something is the way it is, write the question as `- ? <question>` for the person to answer.
   - **Traps:** what looks wrong but is intentional, and the invariants that must hold.
   - A section with nothing true to say: delete its `TODO` line instead of writing generic text.
   - When no `TODO` is left, delete the `<!-- Drafted by reins notes new … -->` comment line.
   - **Modules with parts** (`<module>.md` plus `<module>/<part>.md`): fill the module's note first. It holds what every part shares (layout, data loading, conventions); each part's note holds only what is specific to it and never repeats the module's note.
4. Keep each note under 60 lines. Don't change the `paths` in the frontmatter; if they look wrong, say so.
5. If you created or renamed a note, run `npx reins sync` (it updates the index in `AGENTS.md`). Then `npx reins doctor`: no `note-draft` should remain.
6. Reply with: the notes you filled, the open questions (`?` lines) for the person, and anything you are unsure about.

## Review (when asked to review notes, or with "review")

Notes that are no longer true are worse than none. Check them against the code; this costs tokens, so only do the ones asked for.

1. Pick the notes: the ones the person named, or the top of `npx reins notes stale` (5 by default), plus any note `npx reins doctor` reports as `note-dead-paths` or `note-dead-refs`.
2. For each note:
   - **Paths:** if a glob matches no file, find where the module went (`git log --follow`, search by name) and fix `paths`; if the module is gone, say so and propose deleting the note. Don't delete it yourself.
   - **Names:** fix files and folders that were renamed or moved; remove lines about what no longer exists.
   - **Claims:** check each line of Map, How it works, Decisions and Traps against the code and the commits since the note last changed (`git log <date>.. -- <paths>`). Fix what is no longer true. A decision that was reversed: replace it with the new one, dated, with its why if the code or history says it; otherwise write `- ? <question>`.
   - Keep what is still true as it is. Don't rewrite for style.
3. Run `npx reins sync` if you changed any `paths`, then `npx reins doctor`.
4. Reply with: per note, what you changed and why (or "still accurate"), and the open questions for the person.
