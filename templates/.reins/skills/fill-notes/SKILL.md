---
name: fill-notes
description: Fill in or improve the module notes in .reins/notes/ (purpose, map, how it works, decisions, traps). Use it after reins init or reins notes new, when reins doctor reports note-draft, or when asked to document a module.
---
# Fill in module notes

A note is for someone who has never seen the module and has to change it safely today. If the code says something plainly, it doesn't go in the note.

1. Find the notes to fill: the lines starting with `TODO` in `.reins/notes/*.md` (`npx reins doctor` reports them as `note-draft`). If the person named a module, do only that one.
2. For each note, read the code under its `paths`: the public API first, then the most imported files listed in its Map. Stop when you can explain the module; don't read all of it.
3. Replace every `TODO` line:
   - **Purpose:** what the module does and for whom, in one or two lines.
   - **Map:** one line per key file worth knowing. Keep the lines reins generated (public API, files, used by, depends on).
   - **How it works:** the main flow in a few lines: where the data comes from, what changes it, who reads it.
   - **Decisions:** only what the code, its comments, the git history (`git log --follow <file>`) or the person confirm, each with its date and its why. **Never invent a reason.** If you can't tell why something is the way it is, write the question as `- ? <question>` for the person to answer.
   - **Traps:** what looks wrong but is intentional, and the invariants that must hold.
   - A section with nothing true to say: delete its `TODO` line instead of writing generic text.
   - When no `TODO` is left, delete the `<!-- Drafted by reins notes new … -->` comment line.
4. Keep each note under 60 lines. Don't change the `paths` in the frontmatter; if they look wrong, say so.
5. If you created or renamed a note, run `npx reins sync` (it updates the index in `AGENTS.md`). Then `npx reins doctor`: no `note-draft` should remain.
6. Reply with: the notes you filled, the open questions (`?` lines) for the person, and anything you are unsure about.
