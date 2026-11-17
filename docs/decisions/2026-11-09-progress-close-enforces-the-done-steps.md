# `progress close` enforces the done steps (2026-11-09)

An agent told "close it" ran `reins progress close` straight away and skipped the done skill: the module notes were not updated, and reins deletes the notebook a week after closing, so what was learned would have been lost. The skill was only advice.

| Decision | Why |
| --- | --- |
| `close` refuses while an item of the notebook is neither done `[x]` nor dropped `[-]` | Pending work in a closed notebook is lost a week later. Dropping takes a reason, so nothing is skipped silently |
| `close` refuses while the doctor flags a module note of the task's files (`note-missing`, `note-outdated`, `note-draft`, `note-dead-paths`, `note-dead-refs`) | Step 3 of the done skill is the one that gets skipped, and the doctor already knows which notes the task touched |
| `--notes-ok "<why>"` closes anyway and writes the reason into the notebook | Some flagged notes need nothing (a version bump touches `package.json`); the reason makes the skip visible instead of a bare `--force` |
| Not gated: tests, `reins check`, the reply to the person | reins can't tell whether the agent ran them; the skill still asks for them |
